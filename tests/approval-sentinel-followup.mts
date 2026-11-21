/**
 * Sentinel follow-up on the frozen Devin head. These assertions fail until the
 * wire hash and the exact hash can both be stored, non-ASCII recipients are
 * refused, and the daily cap is handed to the send path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { recipientAllowlist, recipientAllowed } from "../src/lib/approval/allowlist.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const CYRILLIC_RECIPIENT = "ada@\u0435\u0445ample.com";

test("test_dispatcher_and_send_route_check_wire_hash_and_exact_hash", () => {
  const dispatch = read("src/lib/dispatch-outbound.ts");
  const send = read("src/app/api/outreach/send/route.ts");
  for (const source of [dispatch, send]) {
    assert.match(source, /exact_body_hash/);
    assert.match(source, /approvalHash\(/);
    assert.match(source, /exactBodyHash\(/);
  }
});

test("test_non_ascii_recipient_is_refused_and_ascii_still_matches", () => {
  const ascii = recipientAllowlist("demo", "example.com");
  assert.equal(recipientAllowed(ascii, CYRILLIC_RECIPIENT), false);
  assert.equal(recipientAllowed(ascii, "ada@example.com"), true);
  assert.equal(recipientAllowed(ascii, "  ada@mail.example.com  "), true);

  const listed = recipientAllowlist("demo", CYRILLIC_RECIPIENT);
  assert.equal(recipientAllowed(listed, CYRILLIC_RECIPIENT), false);
});

test("test_send_path_passes_a_persistent_daily_cap", () => {
  const dispatch = read("src/lib/dispatch-outbound.ts");
  const send = read("src/app/api/outreach/send/route.ts");
  for (const source of [dispatch, send]) {
    assert.match(source, /dailyCap:/);
    assert.match(source, /daily_cap/);
  }
  assert.match(read("supabase/migrations/0013_claim_exact_recompute.sql"), /apply_channel_daily_cap/);
  assert.doesNotMatch(read("src/lib/approval/ledger.ts"), /consultCounts/);
});

test("test_linkedin_token_has_no_dispatch_enable_path", () => {
  const dispatch = read("src/lib/dispatch-outbound.ts");
  const gate = dispatch.slice(dispatch.indexOf('msg.channel === "LinkedIn"'));
  assert.match(gate, /linkedin_token/);
  assert.match(gate, /linkedin-delivery-refused/);
  assert.doesNotMatch(gate, /linkedinTokenEnabled/);
});
