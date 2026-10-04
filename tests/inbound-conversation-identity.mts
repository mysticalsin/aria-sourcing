/* ============================================================================
   tests/inbound-conversation-identity.mts
   Area: inbound reply conversation identity (F3).

   Settled decision under test: replies route by provider context and the
   canonical conversation, NEVER latest outbound address or active campaign;
   ambiguous outcomes fail closed into durable triage, never silent success.

   Two halves, mirroring tests/whatsapp-late-event-safety.mts:
     1. Pure assertions on resolveInboundEmailIdentity (store/inbound-identity)
        — provider thread beats address, address beats nothing, ambiguity and
        no-match fail closed.
     2. Source-inspection contracts on supabase/migrations/0023 (canonical
        conversation table + service-only WhatsApp resolver), on
        src/lib/whatsapp-inbound.ts (identity comes from the resolver RPC, the
        latest-outbound identity lookup is gone, ambiguity routes to triage),
        and on src/lib/store.ts (email auto-match uses the resolver and never
        falls back to the active campaign or campaigns[0]).
   ========================================================================== */

import { existsSync, readFileSync } from "fs";
import { resolveInboundEmailIdentity } from "../src/lib/store/inbound-identity";
import type { Candidate, ClassifiedReply, OutreachMessage } from "../src/lib/types";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

/* ---- Fixtures (same minimal-candidate approach as tests/email-match.mts) -- */

const candidateBase: Omit<Candidate, "id" | "campaignId" | "name" | "email"> = {
  avatarInitials: "AA",
  currentTitle: "Engineer",
  currentCompany: "Acme",
  location: "NYC",
  timezone: "UTC",
  linkedinUrl: "",
  githubUrl: "",
  sourcePlatform: "GitHub",
  sourceQuery: "",
  matchScore: 80,
  matchBreakdown: [],
  techStack: [],
  yearsExperience: 5,
  companyStageExperience: [],
  industryExperience: [],
  recentActivity: "",
  stage: "Contacted",
  lastContactedAt: null,
  outreachHistory: [],
  replyHistory: [],
  booking: null,
  complianceFlags: {
    doNotContact: false,
    suppressed: false,
    unsubscribed: false,
    gdprExportRequested: false,
    anonymized: false,
    suppressedUntil: null,
  },
  createdAt: new Date().toISOString(),
};

function candidate(id: string, campaignId: string, email: string): Candidate {
  return { ...candidateBase, id, campaignId, name: id, email };
}

function reply(
  overrides: Partial<ClassifiedReply> & Pick<ClassifiedReply, "id" | "candidateId" | "campaignId">,
): ClassifiedReply {
  return {
    channel: "Email",
    body: "Sounds interesting.",
    intent: "INTERESTED",
    confidence: 0.9,
    reasoning: "test fixture",
    suggestedAction: "Reply",
    draftResponse: "",
    handled: false,
    slaDueAt: null,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function outreachMessage(
  overrides: Partial<OutreachMessage> & Pick<OutreachMessage, "id" | "candidateId" | "campaignId">,
): OutreachMessage {
  return {
    channel: "Email",
    subject: "Role",
    body: "Hello",
    tone: "Casual Professional",
    personalizationEvidence: [],
    status: "Approved",
    sequenceStep: 1,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ---- 1. Pure resolver semantics ------------------------------------------ */

// Provider thread wins over campaign context: the same address exists on
// candidate B in another campaign, but a prior reply on this exact thread is
// bound to candidate A — the thread names the candidate.
{
  const shared = "dupe@example.com";
  const identity = resolveInboundEmailIdentity({
    candidates: [candidate("cand-a", "camp-x", shared), candidate("cand-b", "camp-y", shared)],
    replies: [reply({ id: "rep-1", candidateId: "cand-a", campaignId: "camp-x", inboxThreadId: "thread-1" })],
    outreach: [],
    fromAddress: shared,
    inboxThreadId: "thread-1",
  });
  ok(
    "provider thread beats address collisions and campaign context",
    identity.status === "matched" && identity.candidateId === "cand-a" && identity.campaignId === "camp-x",
  );
}

// An outbound draft's inboxThreadId is equally canonical conversation evidence.
{
  const identity = resolveInboundEmailIdentity({
    candidates: [candidate("cand-a", "camp-x", "a@example.com")],
    replies: [],
    outreach: [outreachMessage({ id: "msg-1", candidateId: "cand-a", campaignId: "camp-x", inboxThreadId: "thread-2" })],
    fromAddress: "unknown-alias@example.com",
    inboxThreadId: "thread-2",
  });
  ok(
    "outbound draft thread binding resolves the candidate",
    identity.status === "matched" && identity.candidateId === "cand-a" && identity.campaignId === "camp-x",
  );
}

// A prior UNASSIGNED reply on the thread (candidateId "") is not identity.
{
  const identity = resolveInboundEmailIdentity({
    candidates: [candidate("cand-a", "camp-x", "a@example.com")],
    replies: [reply({ id: "rep-1", candidateId: "", campaignId: "", inboxThreadId: "thread-3" })],
    outreach: [],
    fromAddress: "a@example.com",
    inboxThreadId: "thread-3",
  });
  ok(
    "an unassigned prior reply on the thread is not treated as identity",
    identity.status === "matched" && identity.candidateId === "cand-a",
  );
}

// Unique address match with no thread evidence resolves to the one candidate.
{
  const identity = resolveInboundEmailIdentity({
    candidates: [candidate("cand-a", "camp-x", "a@example.com"), candidate("cand-b", "camp-y", "b@example.com")],
    replies: [],
    outreach: [],
    fromAddress: "b@example.com",
  });
  ok(
    "unique address match resolves without thread evidence",
    identity.status === "matched" && identity.candidateId === "cand-b" && identity.campaignId === "camp-y",
  );
}

// Two candidates sharing the address with no thread evidence is AMBIGUOUS —
// it never picks either one (fail closed into the unassigned reply stream).
{
  const shared = "dupe@example.com";
  const identity = resolveInboundEmailIdentity({
    candidates: [candidate("cand-a", "camp-x", shared), candidate("cand-b", "camp-y", shared)],
    replies: [],
    outreach: [],
    fromAddress: shared,
  });
  ok("shared address without thread evidence is ambiguous, never auto-assigned", identity.status === "ambiguous");
}

// No evidence at all is unmatched.
ok(
  "unknown sender is unmatched",
  resolveInboundEmailIdentity({
    candidates: [candidate("cand-a", "camp-x", "a@example.com")],
    replies: [],
    outreach: [],
    fromAddress: "nobody@example.com",
  }).status === "unmatched",
);
ok(
  "missing fromAddress is unmatched",
  resolveInboundEmailIdentity({ candidates: [candidate("cand-a", "camp-x", "a@example.com")], replies: [], outreach: [] })
    .status === "unmatched",
);

// Address comparison is case-insensitive.
{
  const identity = resolveInboundEmailIdentity({
    candidates: [candidate("cand-a", "camp-x", "Alice@Example.com")],
    replies: [],
    outreach: [],
    fromAddress: "ALICE@EXAMPLE.COM",
  });
  ok("address matching is case-insensitive", identity.status === "matched" && identity.candidateId === "cand-a");
}

/* ---- 2. Source-inspection contracts -------------------------------------- */

const migrationUrl = new URL("../supabase/migrations/0023_conversation_identity.sql", import.meta.url);
const authorityMigrationUrl = new URL("../supabase/migrations/0028_conversation_authority_hardening.sql", import.meta.url);
const inboundProcessor = readFileSync(new URL("../src/lib/whatsapp-inbound.ts", import.meta.url), "utf8");
const storeText = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const outreachSendRoute = readFileSync(new URL("../src/app/api/outreach/send/route.ts", import.meta.url), "utf8");
const whatsappTemplateRoute = readFileSync(new URL("../src/app/api/outreach/whatsapp-template/route.ts", import.meta.url), "utf8");

ok("conversation-identity migration exists", existsSync(migrationUrl));
if (existsSync(migrationUrl)) {
  const migration = readFileSync(migrationUrl, "utf8");
  ok("migration creates the canonical conversation table", /create table if not exists public\.agent_conversations/.test(migration));
  ok(
    "one conversation per workspace/channel/provider-thread key",
    /unique \(workspace_id, channel, provider_thread_key\)/.test(migration),
  );
  ok(
    "WhatsApp resolver is a SECURITY DEFINER service RPC",
    /resolve_whatsapp_inbound_conversation/.test(migration) && /security definer/.test(migration),
  );
  ok(
    "resolver asserts the service role in-body",
    /resolve_whatsapp_inbound_conversation[\s\S]*?auth\.role\(\)[\s\S]*?service_role/.test(migration),
  );
  ok(
    "resolver verifies the active processing claim before resolving identity",
    /processing_claim_id is distinct from p_claim_id/.test(migration),
  );
  ok("an unknown thread fails closed", /'no-conversation'/.test(migration));
  ok("an ambiguous thread fails closed, never auto-assigns", /'ambiguous-conversation'/.test(migration));
  ok(
    "resolver derives bootstrap bindings from the sender's seat, not the bare address",
    /m\.seat_id = sender\.seat_id/.test(migration),
  );
  ok(
    "resolver execute is granted to the service role only",
    /revoke all on function public\.resolve_whatsapp_inbound_conversation\(uuid, uuid\) from public, anon, authenticated/.test(migration) &&
      /grant execute on function public\.resolve_whatsapp_inbound_conversation\(uuid, uuid\) to service_role/.test(migration),
  );
  ok(
    "inbound messages gain a conversation foreign key",
    /alter table public\.messages_inbound\s+add column if not exists conversation_id uuid references public\.agent_conversations\(id\)/.test(migration),
  );
  ok(
    "outbound messages gain a conversation foreign key",
    /alter table public\.messages_outbound\s+add column if not exists conversation_id uuid references public\.agent_conversations\(id\)/.test(migration),
  );
  // Same standalone-transaction rule bootstrap-contract.mts applies to every
  // numbered migration — the bootstrap runner owns transaction boundaries.
  ok(
    "migration leaves transaction ownership to the bootstrap runner",
    !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
  );
}

ok("conversation-authority hardening migration exists", existsSync(authorityMigrationUrl));
if (existsSync(authorityMigrationUrl)) {
  const authorityMigration = readFileSync(authorityMigrationUrl, "utf8");
  ok(
    "authenticated callers lose all direct inbound and outbound message mutation",
    /revoke insert, update, delete on public\.messages_outbound from authenticated/.test(authorityMigration) &&
      /revoke insert, update, delete on public\.messages_inbound from authenticated/.test(authorityMigration),
  );
  ok(
    "service workers retain explicit message-ledger mutation authority",
    /grant select, insert, update, delete on public\.messages_outbound to service_role/.test(authorityMigration) &&
      /grant select, insert, update, delete on public\.messages_inbound to service_role/.test(authorityMigration),
  );
  ok(
    "message and conversation rows carry owner authority",
    /alter table public\.messages_outbound[\s\S]*?add column if not exists owner_id uuid/.test(authorityMigration) &&
      /alter table public\.messages_inbound[\s\S]*?add column if not exists owner_id uuid/.test(authorityMigration) &&
      /alter table public\.agent_conversations[\s\S]*?add column if not exists owner_id uuid/.test(authorityMigration),
  );
  ok(
    "outbound spec authority is enforced by one composite database foreign key",
    /messages_outbound_workspace_owner_spec_fkey[\s\S]*?foreign key \(workspace_id, owner_id, spec_id\)[\s\S]*?references public\.agent_specs \(workspace_id, owner_id, id\)/.test(authorityMigration),
  );
  ok(
    "conversation spec authority is enforced by one composite database foreign key",
    /agent_conversations_workspace_owner_spec_fkey[\s\S]*?foreign key \(workspace_id, owner_id, spec_id\)[\s\S]*?references public\.agent_specs \(workspace_id, owner_id, id\)/.test(authorityMigration),
  );
  ok(
    "outbound conversation authority is enforced by workspace and owner",
    /messages_outbound_conversation_authority_fkey[\s\S]*?foreign key \(conversation_id, workspace_id, owner_id\)[\s\S]*?references public\.agent_conversations \(id, workspace_id, owner_id\)/.test(authorityMigration),
  );
  ok(
    "unproven legacy owner bindings are invalidated instead of guessed",
    /provider_message_id is not null/.test(authorityMigration) &&
      /status = 'sent'/.test(authorityMigration) &&
      /set spec_id = null,[\s\S]*?owner_id = null/.test(authorityMigration),
  );
  ok(
    "resolver bootstrap requires exact owner/spec and durable provider acceptance",
    /join public\.agent_specs as spec[\s\S]*?spec\.workspace_id = m\.workspace_id[\s\S]*?spec\.owner_id = m\.owner_id/.test(authorityMigration) &&
      /m\.status = 'sent'/.test(authorityMigration) &&
      /m\.provider_message_id is not null/.test(authorityMigration) &&
      /m\.delivery_attempt_id is not null/.test(authorityMigration),
  );
  ok(
    "resolver returns exact owner authority with the conversation receipt",
    /'owner_id', resolved_owner_id/.test(authorityMigration),
  );
  ok(
    "human WhatsApp queue writes use one authenticated security-definer RPC",
    /create or replace function public\.enqueue_whatsapp_outbound\(/.test(authorityMigration) &&
      /security definer/.test(authorityMigration) &&
      /grant execute on function public\.enqueue_whatsapp_outbound/.test(authorityMigration),
  );
  ok(
    "the enqueue RPC revalidates actor, workspace, candidate, approval, sender, and template authority",
    /from public\.profiles[\s\S]*?for share/.test(authorityMigration) &&
      /state -> 'candidates'/.test(authorityMigration) &&
      /from public\.outreach_approvals[\s\S]*?for update/.test(authorityMigration) &&
      /from public\.whatsapp_senders/.test(authorityMigration) &&
      /from public\.whatsapp_templates/.test(authorityMigration),
  );
  ok(
    "authority migration leaves transaction ownership to the bootstrap runner",
    !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(authorityMigration),
  );
}

// WhatsApp processor: identity comes from the conversation resolver, and the
// latest-outbound-address lookup no longer supplies candidate/spec identity.
ok(
  "WhatsApp inbound resolves identity through the conversation RPC",
  /rpc\(\s*"resolve_whatsapp_inbound_conversation"/.test(inboundProcessor),
);
ok(
  "a failed conversation resolution routes to durable triage",
  /convo\.ok !== true\) return complete\("triage", convo\?\.reason \?\? "no-conversation"\)/.test(inboundProcessor),
);
ok(
  "the latest-outbound identity lookup is gone",
  !/select\("candidate_id, spec_id/.test(inboundProcessor) && !/no-active-thread/.test(inboundProcessor),
);
ok(
  "the review draft is bound to its conversation",
  /conversation_id: conversationId/.test(inboundProcessor),
);
ok(
  "the review draft dedupe identity comes from the conversation, not an outbound row",
  /dedupeHash\(conversationCandidateId, "WhatsApp"/.test(inboundProcessor),
);
ok(
  "the service worker binds agent lookup to workspace, owner, and spec",
  /\.from\("agent_specs"\)[\s\S]*?\.eq\("id", convo\.spec_id\)[\s\S]*?\.eq\("workspace_id", workspaceId\)[\s\S]*?\.eq\("owner_id", convo\.owner_id\)/.test(inboundProcessor),
);
ok(
  "the service worker persists exact owner authority on generated drafts",
  /owner_id: convo\.owner_id/.test(inboundProcessor),
);
ok(
  "human reply queueing no longer writes the message table as the authenticated role",
  /rpc\(\s*"enqueue_whatsapp_outbound"/.test(outreachSendRoute) &&
    !/\.from\("messages_outbound"\)\s*\.insert\(/.test(outreachSendRoute),
);
ok(
  "approved-template queueing no longer writes the message table as the authenticated role",
  /rpc\(\s*"enqueue_whatsapp_outbound"/.test(whatsappTemplateRoute) &&
    !/\.from\("messages_outbound"\)\s*\.insert\(/.test(whatsappTemplateRoute),
);

// Email auto-match: the resolver replaces active-campaign arbitration, and
// unmatched auto-ingested mail is never attributed to the active campaign or
// an arbitrary first campaign.
ok("email auto-match routes through the inbound identity resolver", /resolveInboundEmailIdentity\(\{/.test(storeText));
ok(
  "the active-campaign-scoped address match is gone",
  !/matchCandidateByEmail\(s\.candidates, input\.fromAddress/.test(storeText),
);
ok(
  "unmatched auto-ingested mail no longer falls back to activeCampaignId/campaigns[0]",
  !/candidate\?\.campaignId \?\? s\.activeCampaignId \?\? s\.campaigns\[0\]\?\.id/.test(storeText),
);
ok(
  "an ambiguous sender is queued for human review",
  /sender matches multiple candidates/.test(storeText),
);

console.log(`RESULT inbound-conversation-identity: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
