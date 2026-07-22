import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLoginEmail } from "../src/lib/auth/login-email";

test("login requires a complete address and never invents a fallback domain", () => {
  assert.equal(normalizeLoginEmail("admin", ""), null);
  assert.equal(normalizeLoginEmail("admin", "mantu.com"), null);
  assert.equal(normalizeLoginEmail("admin@hermes.local", "mantu.com"), null);
});

test("login accepts only the exact configured domain and canonicalizes its case", () => {
  assert.equal(normalizeLoginEmail("Tony@MANTU.COM", "mantu.com"), "Tony@mantu.com");
  assert.equal(normalizeLoginEmail("tony@sub.mantu.com", "mantu.com"), null);
  assert.equal(normalizeLoginEmail("tony@mantu.com.attacker.test", "mantu.com"), null);
});

test("login rejects ambiguous, padded, control-bearing, and malformed addresses", () => {
  for (const value of [
    " tony@mantu.com",
    "tony@mantu.com ",
    "tony@@mantu.com",
    "@mantu.com",
    "tony@",
    "tony@.mantu.com",
    "tony@mantu..com",
    "tony@mantu.com\n",
  ]) assert.equal(normalizeLoginEmail(value, "mantu.com"), null, value);
});
