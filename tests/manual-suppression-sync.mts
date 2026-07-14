import {
  persistManualSuppression,
  normalizeSuppressionValue,
  suppressionDeleteConfirmed,
} from "../src/lib/manual-suppression";
import { readFileSync } from "node:fs";
import { allocateBatch, suppressionMatch } from "../src/lib/fleet";
import { buildSeedState } from "../src/lib/seed";
import type { SuppressionEntry } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

ok("email suppression normalizes case", normalizeSuppressionValue("email", " Person@Example.COM ") === "person@example.com");
ok("domain suppression normalizes leading at-sign", normalizeSuppressionValue("domain", "@Example.COM") === "example.com");
ok("phone suppression normalizes to canonical WhatsApp digits", normalizeSuppressionValue("phone", "+1 (416) 555-0123") === "14165550123");
ok("invalid email fails closed", normalizeSuppressionValue("email", "not-an-email") === null);
ok("invalid domain fails closed", normalizeSuppressionValue("domain", "https://example.com/path") === null);
ok("zero-row delete is not confirmed", !suppressionDeleteConfirmed(null));
ok("deleted row id confirms removal", suppressionDeleteConfirmed({ id: "suppression-1" }));

const phoneSuppression: SuppressionEntry = {
  id: "phone-suppression",
  type: "phone",
  value: "14165550123",
  reason: "Opted out",
  source: "test",
  createdAt: new Date().toISOString(),
  expiresAt: null,
};
const seed = buildSeedState();
const candidate = { ...seed.candidates[0], phone: "+1 (416) 555-0123" };
ok(
  "formatted E.164 candidate matches canonical phone suppression",
  suppressionMatch([phoneSuppression], candidate)?.id === phoneSuppression.id,
);
const allocation = allocateBatch(
  [candidate],
  [{ ...seed.seats[0], status: "active", sentToday: 0, warmup: false }],
  [],
  [phoneSuppression],
  seed.settings.fleet,
  new Date(),
);
ok(
  "allocation performs zero assignments for a phone-suppressed candidate",
  allocation.assignments.length === 0 && allocation.skipped.some((item) => item.candidateId === candidate.id),
);

const confirmed = await persistManualSuppression(
  { type: "email", value: "Person@Example.com", reason: "Opted out" },
  "POST",
  async () => new Response(JSON.stringify({ ok: true, synced: true, value: "person@example.com" }), { status: 200 }),
);
ok("confirmed server write returns normalized enforcement value", confirmed.ok && confirmed.value === "person@example.com");

const rejected = await persistManualSuppression(
  { type: "domain", value: "example.com", reason: "Client" },
  "POST",
  async () => new Response(JSON.stringify({ ok: false, error: "storage unavailable" }), { status: 503 }),
);
ok("failed server write is not reported as success", !rejected.ok);

let method = "";
await persistManualSuppression(
  { type: "phone", value: "+14165550123", reason: "Restore" },
  "DELETE",
  async (_url, init) => {
    method = init?.method ?? "";
    return new Response(JSON.stringify({ ok: true, synced: true, value: "14165550123" }), { status: 200 });
  },
);
ok("removal uses the same confirmed endpoint with DELETE", method === "DELETE");

const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
ok(
  "live add waits for enforcement confirmation before local commit",
  /const addSuppression[\s\S]{0,1400}await persistManualSuppression[\s\S]{0,900}commit\(/.test(storeSource),
);
ok(
  "live removal waits for enforcement confirmation before local removal",
  /const removeSuppression[\s\S]{0,1200}await persistManualSuppression[\s\S]{0,700}commit\(/.test(storeSource),
);
const routeSource = readFileSync(new URL("../src/app/api/compliance/suppress/route.ts", import.meta.url), "utf8");
ok(
  "DELETE selects the removed row and rejects a zero-row result",
  /\.delete\(\)[\s\S]{0,250}\.select\("id"\)[\s\S]{0,600}suppressionDeleteConfirmed/.test(routeSource),
);

console.log(`RESULT manual-suppression-sync: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
