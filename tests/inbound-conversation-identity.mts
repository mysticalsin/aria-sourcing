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
const inboundProcessor = readFileSync(new URL("../src/lib/whatsapp-inbound.ts", import.meta.url), "utf8");
const storeText = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");

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
