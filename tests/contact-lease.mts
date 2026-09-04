/* ==========================================================================
   tests/contact-lease.mts
   Shared contact lease exclusivity + knowledge plane never grants claims.
   ========================================================================== */

import {
  InMemoryContactLeaseStore,
  normalizeContactIdentityKey,
  knowledgePlaneMayGrantContactClaim,
} from "../src/lib/contact-lease";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "identity prefers linkedin slug",
  normalizeContactIdentityKey({
    candidateId: "c1",
    linkedinUrl: "https://www.linkedin.com/in/Jane-Doe/",
  }).startsWith("li:"),
);
ok("knowledge plane never grants contact claims", knowledgePlaneMayGrantContactClaim() === false);

async function chaos() {
  const store = new InMemoryContactLeaseStore();
  const candidate = {
    candidateId: "cand-1",
    linkedinUrl: "https://linkedin.com/in/same-person",
  };
  const claims = await Promise.all(
    Array.from({ length: 80 }, (_, i) =>
      store.claim({
        workspaceId: "ws1",
        candidate,
        seatId: `seat-${i}`,
        ttlMs: 60_000,
      }),
    ),
  );
  const winners = claims.filter((c) => c.ok);
  ok("chaos: exactly one winner among 80 concurrent claimers", winners.length === 1);
  ok("chaos: losers are not ok", claims.filter((c) => !c.ok).every((l) => l.ok === false));
  if (winners[0]?.ok) {
    const key = normalizeContactIdentityKey(candidate);
    await store.markInFlight("ws1", key, winners[0].lease.seatId, "job-1");
    const second = await store.claim({
      workspaceId: "ws1",
      candidate,
      seatId: "seat-other",
    });
    ok("in-flight lease blocks other seats", second.ok === false);
    ok("blocked reason is lease-held", second.ok === false && second.reason === "lease-held");
  }
}

await chaos();

const migration = readFileSync(
  new URL("../supabase/migrations/0063_contact_lease_and_browser_computer.sql", import.meta.url),
  "utf8",
);
ok("migration 0063 defines claim_contact", /create or replace function public\.claim_contact\(/i.test(migration));
ok("migration 0063 uses skip locked", /for update skip locked/i.test(migration));
ok("migration 0063 allows browser-computer enqueue", /LinkedIn Browser Computer/i.test(migration));
ok("migration 0063 contact_leases table", /create table if not exists public\.contact_leases/i.test(migration));

console.log(`RESULT contact-lease: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
