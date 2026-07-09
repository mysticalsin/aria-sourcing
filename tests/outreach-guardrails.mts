/* ============================================================================
   tests/outreach-guardrails.mts
   Area: outreach send guardrails (audit Gate 9) — Subject header (MIME) injection
   and suppression / do-not-contact enforcement.

   SCOPE NOTE — two of the guardrails live inside the request handler
   `src/app/api/outreach/send/route.ts`, which is NOT unit-reachable without a
   live Supabase client + authenticated session:

     1. `sanitizeHeader(subject)` is a *private* (un-exported) function in that
        route, and its sanitised value is only ever passed to a live provider
        send — never echoed in any dry-run response. It therefore cannot be
        imported or observed end-to-end. The block below is a CONTRACT test: it
        mirrors the route's exact implementation and asserts the security
        property (CR/LF + control chars stripped → no header/MIME injection).
        Keep in sync with the route. RECOMMENDATION: export `sanitizeHeader` so
        this becomes a true import-the-real-code regression test.

     2. The route's own suppression check queries the RLS-scoped `suppression_list`
        table and re-checks atomically in the `claim_and_record` RPC — both need a
        live DB. The suppression block below exercises the canonical, exported
        matching helper `suppressionMatch` (src/lib/fleet.ts), which implements
        the same email / domain / expiry semantics the server guardrail relies on.
   ========================================================================== */

import { readFileSync } from "fs";
import { suppressionMatch } from "../src/lib/fleet";
import type { SuppressionEntry } from "../src/lib/types";
import { approvalHash, approvalScopeHash, sanitizeOutreachSubject } from "../src/lib/outreach-content";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ===========================================================================
   1. Subject CRLF / control-char sanitization (CONTRACT — mirror of
      src/app/api/outreach/send/route.ts:sanitizeHeader; keep in sync).
   ========================================================================= */
ok("strips CRLF (\\r\\n) from the subject", sanitizeOutreachSubject("Hello\r\nWorld") === "Hello World");
ok("strips bare LF, CR and TAB", sanitizeOutreachSubject("a\nb\rc\td") === "a b c d");
{
  // Classic SMTP/MIME header-injection payload: a smuggled Bcc header.
  const out = sanitizeOutreachSubject("Quick chat\r\nBcc: attacker@evil.example");
  ok("header-injection payload has no CR/LF left", !out.includes("\r") && !out.includes("\n"));
  ok("header-injection payload collapses to a single line", out === "Quick chat Bcc: attacker@evil.example");
}
ok("strips NUL and DEL control chars", sanitizeOutreachSubject("a\x00b\x7Fc") === "a b c");
ok("collapses runs of whitespace", sanitizeOutreachSubject("a    b") === "a b");
ok("trims leading/trailing whitespace", sanitizeOutreachSubject("  hi there  ") === "hi there");
ok("leaves a clean subject intact", sanitizeOutreachSubject("Quick question about your role") === "Quick question about your role");
ok(
  "approval hash is computed from the exact sanitized content that reaches a provider",
  approvalHash("Quick chat\r\nBcc: attacker@evil.example", "Hello") === approvalHash("Quick chat Bcc: attacker@evil.example", "Hello"),
);
ok(
  "approval scope binds a WhatsApp approval to the candidate and canonical recipient",
  approvalScopeHash({ candidateId: "cand-1", channel: "WhatsApp", recipient: "+33 6 12 34 56 78" }) ===
    approvalScopeHash({ candidateId: "cand-1", channel: "WhatsApp", recipient: "33612345678" }),
);
ok(
  "approval scope changes when an approved message is redirected to another candidate",
  approvalScopeHash({ candidateId: "cand-1", channel: "WhatsApp", recipient: "33612345678" }) !==
    approvalScopeHash({ candidateId: "cand-2", channel: "WhatsApp", recipient: "33612345678" }),
);

/* ===========================================================================
   2. Suppression / do-not-contact guardrail (real exported matcher).
   ========================================================================= */
const NOW = Date.parse("2026-06-01T00:00:00.000Z");
const ISO_PAST = "2026-01-01T00:00:00.000Z";
const ISO_FUTURE = "2026-12-01T00:00:00.000Z";

function entry(over: Partial<SuppressionEntry>): SuppressionEntry {
  return {
    id: over.id ?? "s1",
    type: over.type ?? "email",
    value: over.value ?? "do-not-contact@example.com",
    reason: over.reason ?? "Do-not-contact request",
    source: over.source ?? "Operator",
    createdAt: over.createdAt ?? ISO_PAST,
    expiresAt: over.expiresAt ?? null,
    ...over,
  };
}

const list: SuppressionEntry[] = [
  entry({ id: "perm", type: "email", value: "do-not-contact@example.com", expiresAt: null }),
  entry({ id: "dom", type: "domain", value: "competitor.example", expiresAt: null }),
  entry({ id: "expired", type: "email", value: "lapsed@example.com", expiresAt: ISO_PAST }),
];

// A suppressed recipient is rejected (case-insensitive on the email).
ok(
  "suppressed email recipient is rejected (case-insensitive)",
  suppressionMatch(list, { email: "DO-NOT-CONTACT@example.com", linkedinUrl: "" }, NOW)?.id === "perm",
);
// Any recipient on a suppressed domain is rejected.
ok(
  "recipient on a suppressed domain is rejected",
  suppressionMatch(list, { email: "anyone@competitor.example", linkedinUrl: "" }, NOW)?.id === "dom",
);
// An expired suppression entry no longer rejects (allowed through).
ok(
  "expired suppression entry no longer blocks the recipient",
  suppressionMatch(list, { email: "lapsed@example.com", linkedinUrl: "" }, NOW) === null,
);
// A clean recipient is allowed.
ok(
  "clean recipient is allowed (no match)",
  suppressionMatch(list, { email: "fresh.lead@newco.example", linkedinUrl: "" }, NOW) === null,
);
// A future-dated (still-active) entry blocks.
ok(
  "still-active (future-dated) suppression entry blocks",
  suppressionMatch([entry({ id: "act", value: "timed@example.com", expiresAt: ISO_FUTURE })], { email: "timed@example.com", linkedinUrl: "" }, NOW)?.id === "act",
);

/* ===========================================================================
   3. Human approval provenance (route contract).
   ========================================================================== */
const sendRoute = readFileSync(new URL("../src/app/api/outreach/send/route.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const approveRoute = readFileSync(new URL("../src/app/api/outreach/approve/route.ts", import.meta.url), "utf8");
const revokeRoute = readFileSync(new URL("../src/app/api/outreach/revoke/route.ts", import.meta.url), "utf8");
const approvalLifecycleMigration = readFileSync(new URL("../supabase/migrations/0011_outreach_approval_lifecycle.sql", import.meta.url), "utf8");
ok("send route reads approval provenance", /select\("body_hash, approval_scope_hash, approval_source"\)/.test(sendRoute));
ok("send route rejects approval provenance other than human", /approval\.approval_source\s*!==\s*"human"/.test(sendRoute));
ok("send route verifies the approval scope", /approval\.approval_scope_hash\s*!==\s*approvedScopeHash/.test(sendRoute));
ok("send route never calls the WhatsApp adapter directly", !/await sendWhatsApp\(/.test(sendRoute));
ok("send route routes WhatsApp through the durable outbox", /whatsapp-delivery-queued/.test(sendRoute));
ok("client treats a queued WhatsApp delivery as queued, not sent", /deliveryQueued/.test(store));
ok("client approval waits for server persistence", /await recordOutreachApproval\(/.test(store));
ok("client approval never fire-and-forgets the approval request", !/void fetch\("\/api\/outreach\/approve"/.test(store));
ok("client approval only commits from an actionable draft state", /Message is no longer awaiting approval\./.test(store));
ok("client approval revokes a stale server record before returning blocked", /const revokeStaleApproval/.test(store));
ok("approval route records through the lifecycle RPC", /rpc\("record_outreach_approval"/.test(approveRoute));
ok("revoke route calls the authoritative lifecycle RPC", /rpc\("revoke_outreach_approval"/.test(revokeRoute));
ok("send route excludes revoked approvals", /revoked_at/.test(sendRoute));
ok("send route claims email with the locked approval RPC", /rpc\("claim_email_outbound"/.test(sendRoute));
ok("send route refuses live email without an unsubscribe link", /createEmailUnsubscribeLink\(\)/.test(sendRoute));
ok("lifecycle migration blocks a WhatsApp dispatch without an active approval", /enforce_active_whatsapp_approval/.test(approvalLifecycleMigration));
ok("lifecycle migration binds an email claim to its approval id", /claim_email_outbound/.test(approvalLifecycleMigration));

console.log(`RESULT outreach-guardrails: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
