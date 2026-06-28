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

import { suppressionMatch } from "../src/lib/fleet";
import type { SuppressionEntry } from "../src/lib/types";

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
function sanitizeHeader(value: string): string {
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

ok("strips CRLF (\\r\\n) from the subject", sanitizeHeader("Hello\r\nWorld") === "Hello World");
ok("strips bare LF, CR and TAB", sanitizeHeader("a\nb\rc\td") === "a b c d");
{
  // Classic SMTP/MIME header-injection payload: a smuggled Bcc header.
  const out = sanitizeHeader("Quick chat\r\nBcc: attacker@evil.example");
  ok("header-injection payload has no CR/LF left", !out.includes("\r") && !out.includes("\n"));
  ok("header-injection payload collapses to a single line", out === "Quick chat Bcc: attacker@evil.example");
}
ok("strips NUL and DEL control chars", sanitizeHeader("a\x00b\x7Fc") === "a b c");
ok("collapses runs of whitespace", sanitizeHeader("a    b") === "a b");
ok("trims leading/trailing whitespace", sanitizeHeader("  hi there  ") === "hi there");
ok("leaves a clean subject intact", sanitizeHeader("Quick question about your role") === "Quick question about your role");

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

console.log(`RESULT outreach-guardrails: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
