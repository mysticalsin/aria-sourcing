/**
 * LinkedIn campaign launch scope: fail-closed proofs (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S3).
 *
 *   - a launch without drafts shown writes no approvals (and no grant)
 *   - an edited draft after launch is not dispatchable
 *   - revoke pulls every first-touch row back to draft
 *   - the 0054 trigger body stays byte-identical (hash frozen here; 0055 only adds a branch)
 *   - operator copy: Connect LinkedIn, no vendor names, no em dashes, never AI
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LAUNCH_COPY,
  LAUNCH_PEOPLE_CAP,
  LAUNCH_SCORE_FLOOR,
  draftLaunchState,
  launchDraftApproval,
  launchDraftApprovals,
  shortlistForLaunch,
  type LaunchApprovalRow,
  type LaunchDraft,
} from "../src/lib/linkedin-campaign";
import { SHORTLIST_CAP, SHORTLIST_FLOOR } from "../src/lib/sourcing/engine";
import { approvalHash, approvalScopeHash } from "../src/lib/outreach-content";
import { supabaseLinkedInLoopStore } from "../src/lib/linkedin-loop-store";
import { gateOutbound } from "../src/lib/gate";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function functionBlock(source: string, name: string, args = "\\(\\)"): string {
  const match = source.match(new RegExp(`create or replace function public\\.${name}${args}[\\s\\S]*?\\n\\$\\$;`, "i"));
  if (!match) throw new Error(`Missing function block: ${name}`);
  return match[0].replace(/\r\n/g, "\n");
}

const PROFILE = "https://www.linkedin.com/in/marco-rossi";
const draft: LaunchDraft = {
  messageId: "msg-1",
  candidateId: "cand-1",
  profileUrl: "https://www.linkedin.com/in/Marco-Rossi/?utm=x",
  subject: "",
  body: "Hi Marco, quick note about a Business Analyst role in Paris. Open to a short chat this week?",
};

// ---------------------------------------------------------------------------
// The launch approves exactly the shown drafts, hashed like 0054 re-checks them
// ---------------------------------------------------------------------------
{
  const approval = launchDraftApproval(draft);
  ok("a shown draft hashes to the 0054 body hash", approval?.body_hash === approvalHash(draft.subject, draft.body));
  ok(
    "a shown draft hashes to the 0054 scope hash over the canonical profile URL",
    approval?.scope_hash === approvalScopeHash({ candidateId: "cand-1", channel: "LinkedIn", recipient: PROFILE }),
  );
  ok("no profile URL means no approval, never a guess", launchDraftApproval({ ...draft, profileUrl: "https://example.com/x" }) === null);
  ok("no message id means no approval", launchDraftApproval({ ...draft, messageId: "  " }) === null);
  ok("a launch without drafts shown produces no approvals", launchDraftApprovals([])?.length === 0);
  ok("one unbindable draft fails the whole launch", launchDraftApprovals([draft, { ...draft, messageId: "m2", profileUrl: "" }]) === null);
  ok("a duplicated draft fails the launch", launchDraftApprovals([draft, draft]) === null);
}

// ---------------------------------------------------------------------------
// An edited draft after launch is not dispatchable
// ---------------------------------------------------------------------------
{
  const shown = launchDraftApproval(draft)!;
  const approvals: LaunchApprovalRow[] = [
    { messageId: "msg-1", bodyHash: shown.body_hash, scopeHash: shown.scope_hash, revokedAt: null },
  ];
  ok("the shown draft is launched", draftLaunchState(draft, approvals) === "launched");
  const edited = { ...draft, body: draft.body + " Also, we pay well." };
  ok("an edited draft is 'changed', not launched", draftLaunchState(edited, approvals) === "changed");
  ok("the edited body no longer matches the approval hash", launchDraftApproval(edited)!.body_hash !== shown.body_hash);
  const redirected = { ...draft, profileUrl: "https://www.linkedin.com/in/someone-else" };
  ok("the same copy to another profile is 'changed'", draftLaunchState(redirected, approvals) === "changed");
  ok(
    "a revoked approval means not launched",
    draftLaunchState(draft, [{ ...approvals[0], revokedAt: "2026-09-02T12:00:00Z" }]) === "not-launched",
  );
  ok("an unknown draft is not launched", draftLaunchState({ ...draft, messageId: "msg-9" }, approvals) === "not-launched");

  // The database refuses the edited copy in both places 0054 checks it.
  const m54 = readFileSync("supabase/migrations/0054_linkedin_channel_adapter_authority.sql", "utf8");
  const m56 = readFileSync("supabase/migrations/0056_linkedin_workspace_caps_authority.sql", "utf8");
  const claim = functionBlock(m56, "claim_linkedin_outbound_queued", "\\(p_message_id uuid\\)");
  ok(
    "first-touch claim refuses a body that differs from the approval",
    /approval\.body_hash is distinct from encode\(digest\(coalesce\(outbound\.subject, ''\) \|\| E'\\n' \|\| outbound\.body, 'sha256'\), 'hex'\)/.test(claim) &&
      /'approval-required'/.test(claim),
  );
  ok(
    "trigger refuses a body that differs from the approval",
    /approval\.body_hash is distinct from encode\(digest\(coalesce\(new\.subject, ''\) \|\| E'\\n' \|\| new\.body, 'sha256'\), 'hex'\)/.test(m54),
  );
}

// ---------------------------------------------------------------------------
// The shortlist behind the sheet
// ---------------------------------------------------------------------------
{
  ok("launch floor and cap mirror the sourcing shortlist", LAUNCH_SCORE_FLOOR === SHORTLIST_FLOOR && LAUNCH_PEOPLE_CAP === SHORTLIST_CAP);
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`,
    name: `Person ${String(i).padStart(2, "0")}`,
    currentTitle: "Analyst",
    currentCompany: "Acme",
    matchScore: 50 + i * 2,
    linkedinUrl: i % 7 === 0 ? "" : `https://www.linkedin.com/in/person-${i}`,
  }));
  const list = shortlistForLaunch(many);
  ok("shortlist keeps score 60 or more only", list.every((p) => p.matchScore >= 60));
  ok("shortlist drops people without a LinkedIn profile", list.every((p) => p.profileUrl.startsWith("https://www.linkedin.com/in/")));
  ok("shortlist is capped at 20", list.length === 20);
  ok("shortlist is highest score first", list.every((p, i) => i === 0 || list[i - 1].matchScore >= p.matchScore));
  ok("headline reads title at company", list[0]?.headline === "Analyst at Acme");
  ok("no candidates means nobody", shortlistForLaunch([]).length === 0);
}

// ---------------------------------------------------------------------------
// SQL contract (0057)
// ---------------------------------------------------------------------------
{
  const m57 = readFileSync("supabase/migrations/0057_linkedin_campaign_grant_scope.sql", "utf8");
  ok(
    "0057 adds the grant scope with a two-value check and the 'replies' default",
    /add column if not exists scope text not null default 'replies'/.test(m57) && /check \(scope in \('replies', 'campaign'\)\)/.test(m57),
  );
  ok(
    "0057 binds approval rows to the launch that wrote them",
    /alter table public\.outreach_approvals\s+add column if not exists linkedin_reply_grant_id uuid references public\.linkedin_reply_grants\(id\)/.test(m57),
  );

  const launch = functionBlock(m57, "launch_linkedin_campaign", "\\(");
  const refuse = launch.indexOf("'no-drafts-shown'");
  const grantInsert = launch.indexOf("insert into public.linkedin_reply_grants(");
  const approvalInsert = launch.indexOf("insert into public.outreach_approvals(");
  ok(
    "a launch without drafts shown is refused before the grant and before any approval",
    refuse > 0 && grantInsert > refuse && approvalInsert > grantInsert &&
      /jsonb_array_length\(p_drafts\) = 0 then\s+return json_build_object\('ok', false, 'reason', 'no-drafts-shown'\)/.test(launch),
  );
  ok(
    "every draft is validated before the first write",
    launch.indexOf("'invalid-draft'") < grantInsert && launch.indexOf("'already-dispatching'") < grantInsert,
  );
  ok(
    "approval rows are written only from p_drafts, one per shown draft, as human approvals bound to the grant",
    /for draft in select value from jsonb_array_elements\(p_drafts\) loop\s+insert into public\.outreach_approvals\(/.test(launch) &&
      /draft ->> 'message_id', draft ->> 'body_hash', draft ->> 'scope_hash', actor_id, now\(\),\s+'human', null, null, null, grant_row\.id/.test(launch) &&
      (launch.match(/insert into public\.outreach_approvals\(/g) ?? []).length === 1,
  );
  ok("the launch grant carries scope 'campaign'", /wid, 'LinkedIn', 'campaign', campaign, null, p_seat_id/.test(launch));
  ok(
    "a live reply-only grant is not widened silently; a live campaign grant is 'Add to launch'",
    /if grant_row\.scope <> 'campaign' then\s+return json_build_object\('ok', false, 'reason', 'already-launched'\)/.test(launch) &&
      /added := true;/.test(launch),
  );
  ok("the launch caps a tap at the shortlist size", /jsonb_array_length\(p_drafts\) > 20 then\s+return json_build_object\('ok', false, 'reason', 'too-many-drafts'\)/.test(launch));

  const revoke = functionBlock(m57, "revoke_linkedin_reply_loop", "\\(p_grant_id uuid, p_reason text default null\\)");
  ok(
    "revoke withdraws every approval the launch wrote unless delivery already started",
    /update public\.outreach_approvals a\s+set revoked_at = now\(\),\s+revoked_by = actor_id,\s+revocation_reason = 'linkedin-campaign:launch-revoked'/.test(revoke) &&
      /a\.linkedin_reply_grant_id = any\(revoked_ids\)/.test(revoke) &&
      /l\.status in \('claimed', 'sent', 'ambiguous'\)/.test(revoke),
  );
  ok(
    "revoke pulls every queued first-touch row back to composed, a draft",
    /update public\.messages_outbound m\s+set status = 'composed'/.test(revoke) &&
      /m\.linkedin_reply_grant_id is null/.test(revoke) &&
      /a\.message_id = coalesce\(m\.approval_message_id, m\.id::text\)/.test(revoke),
  );
  ok(
    "revoke keeps the 0055 behaviour for loop replies",
    /set status = 'blocked',\s+gate_result = jsonb_build_object\('pass', false, 'reasons', jsonb_build_array\('linkedin-loop:campaign-launch-revoked'\)\)/.test(revoke) &&
      /linkedin_reply_grant_id is not null/.test(revoke),
  );
  ok(
    "launch is a human action: authenticated only, never service_role",
    /grant execute on function public\.launch_linkedin_campaign\(text, uuid, jsonb, uuid, text, text, int, int, int, text\) to authenticated;/.test(m57) &&
      /revoke all on function public\.launch_linkedin_campaign\(text, uuid, jsonb, uuid, text, text, int, int, int, text\) from public, anon, authenticated, service_role, authenticator;/.test(m57) &&
      !/grant execute on function public\.launch_linkedin_campaign[^;]*to service_role/.test(m57),
  );
  const priv = readFileSync("tests/db/function-privileges.sql", "utf8");
  ok(
    "privilege proof lists the launch and revoke as authenticated",
    /public\.launch_linkedin_campaign\(text,uuid,jsonb,uuid,text,text,integer,integer,integer,text\)'\s*,\s*'authenticated'/.test(priv) &&
      /public\.revoke_linkedin_reply_loop\(uuid,text\)'\s*,\s*'authenticated'/.test(priv),
  );

  // The 0054 trigger body stays byte-identical. 0055 added one branch in front
  // of it; stripping that branch gives the 0054 bytes back. 0056 and 0057 do
  // not touch the trigger at all.
  const m54 = readFileSync("supabase/migrations/0054_linkedin_channel_adapter_authority.sql", "utf8");
  const m55 = readFileSync("supabase/migrations/0055_linkedin_reply_loop_authority.sql", "utf8");
  const m56 = readFileSync("supabase/migrations/0056_linkedin_workspace_caps_authority.sql", "utf8");
  const trigger54 = functionBlock(m54, "enforce_active_linkedin_approval");
  ok("0054 approval trigger body is frozen", sha256(trigger54) === "7193b31a464d67e3e3c39c78220d7ca352b0530f96fe337769b36c19c6440bc3");
  const trigger55 = functionBlock(m55, "enforce_active_linkedin_approval");
  const branch = /\n  -- Loop reply: the human gate was the campaign launch[\s\S]*?end if;\n\n/;
  ok("0055 only adds the grant branch; the rest is the 0054 body byte for byte", branch.test(trigger55) && trigger55.replace(branch, "\n") === trigger54);
  ok(
    "0056 and 0057 do not redefine the approval trigger",
    !/enforce_active_linkedin_approval/.test(m56.replace(/^--.*$/gm, "")) &&
      !/enforce_active_linkedin_approval/.test(m57.replace(/^--.*$/gm, "")) &&
      !/create trigger/.test(m57),
  );
}

// ---------------------------------------------------------------------------
// The route: no drafts shown means no RPC call
// ---------------------------------------------------------------------------
{
  const route = readFileSync("src/app/api/outreach/linkedin-loop/launch/route.ts", "utf8");
  ok(
    "route refuses a campaign launch without drafts before any RPC",
    route.indexOf('"no-drafts-shown"') > 0 &&
      route.indexOf('"no-drafts-shown"') < route.indexOf('rpc("launch_linkedin_campaign"') &&
      /drafts: z\.array\(DraftSchema\)\.max\(LAUNCH_PEOPLE_CAP\)/.test(route),
  );
  ok(
    "route hashes the shown drafts itself and passes only those to the RPC",
    /approvals = launchDraftApprovals\(drafts\)/.test(route) && /p_drafts: approvals \?\? \[\]/.test(route),
  );
  ok(
    "route runs the candidate-bound text gate on every shown draft",
    /validateCandidateBoundText\(draft\.body, internal\)/.test(route) && /detectInjection\(draft\.body\)/.test(route),
  );
  ok("route lists the drafts each launch approved", /from\("outreach_approvals"\)/.test(route) && /\.in\("linkedin_reply_grant_id", campaignGrantIds\)/.test(route));
  ok("reply-only launches keep the 0055 RPC", /rpc\("launch_linkedin_reply_loop"/.test(route));
}

// ---------------------------------------------------------------------------
// Store: scope is read, fail-closed to 'replies'
// ---------------------------------------------------------------------------
await (async () => {
  const selected: string[] = [];
  function clientReturning(row: Record<string, unknown>) {
    return {
      from: () => ({
        select: (cols: string) => {
          selected.push(cols);
          return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) };
        },
      }),
    } as never;
  }
  const base = { workspace_id: "ws", channel: "LinkedIn", campaign_id: "c1", seat_id: "s1" };
  const campaign = await supabaseLinkedInLoopStore(clientReturning({ ...base, id: "g1", scope: "campaign" })).getGrant("g1");
  const legacy = await supabaseLinkedInLoopStore(clientReturning({ ...base, id: "g2" })).getGrant("g2");
  ok("store selects the scope column", selected.every((cols) => /\bscope\b/.test(cols)));
  ok("store reads a campaign scope", campaign?.scope === "campaign");
  ok("a missing scope reads as 'replies'", legacy?.scope === "replies");
})();

// ---------------------------------------------------------------------------
// Operator copy: Connect LinkedIn, no vendor, no em dash, never AI
// ---------------------------------------------------------------------------
{
  const copy = Object.values(LAUNCH_COPY).join("\n");
  ok("launch copy has no em dash", !copy.includes("—"));
  ok("launch copy names no vendor", !/heyreach|unipile|phantombuster|dux-?soup|vendor/i.test(copy));
  ok("launch copy never says AI, assistant, automation, bot or model", !/\b(AI|assistant|automation|bot|model)\b/.test(copy));
  ok("launch copy points at Connect LinkedIn, not a console", /Connect LinkedIn in Fleet/.test(LAUNCH_COPY.noSeat));
  ok("launch copy passes the candidate-facing gate", gateOutbound(LAUNCH_COPY.description).pass);

  const sheet = readFileSync("src/components/outreach/launch-outreach-sheet.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s(,;{])\/\/.*$/gm, "$1");
  ok("sheet buttons are Launch outreach and Add to launch", /LAUNCH_COPY\.addToLaunch : LAUNCH_COPY\.launch/.test(sheet));
  ok("people added later show as not launched", /LAUNCH_COPY\.notLaunched/.test(sheet) && /LAUNCH_COPY\.changed/.test(sheet));
  ok("sheet shows both daily limits, quiet hours and the calendar", /launch-message-cap/.test(sheet) && /launch-connect-cap/.test(sheet) && /Quiet from/.test(sheet) && /Interviews go on/.test(sheet));
  ok("sheet sends only the drafts on screen", /drafts: pending,/.test(sheet) && /scope: "campaign"/.test(sheet));
  ok("sheet never says vendor, AI or automation", !/vendor|\bAI\b|\bautomation\b|\bbot\b/.test(sheet.replace(/LINKEDIN_VENDOR_PROVIDER/g, "")));
  ok("sheet has no em dash in prose", !/[^"'`]—[^"'`]/.test(sheet));
  const page = readFileSync("src/app/campaigns/[id]/page.tsx", "utf8");
  ok("campaign page opens the sheet from Launch outreach", /data-testid="launch-outreach-open"/.test(page) && /<LaunchOutreachSheet/.test(page));
}

console.log(`RESULT linkedin-campaign-launch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
