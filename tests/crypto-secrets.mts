import { encryptSecret, decryptSecret, secretEncryptionEnabled } from "../src/lib/crypto-secrets";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

// --- No key configured: backward-compatible passthrough ---------------------
delete process.env.DATA_ENCRYPTION_KEY;
ok("no key: encryption reported disabled", !secretEncryptionEnabled());
ok("no key: encrypt passes plaintext through", encryptSecret("sk-abc") === "sk-abc");
ok("no key: decrypt passes plaintext through", decryptSecret("sk-abc") === "sk-abc");

// --- Key configured: real round-trip ----------------------------------------
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
ok("key: encryption reported enabled", secretEncryptionEnabled());
const enc = encryptSecret("sk-ant-secret-123");
ok("key: ciphertext is prefixed and differs from plaintext", enc.startsWith("enc:v1:") && enc !== "sk-ant-secret-123");
ok("key: round-trips back to the plaintext", decryptSecret(enc) === "sk-ant-secret-123");
ok("key: legacy plaintext still passes through (mixed-state safe)", decryptSecret("sk-legacy-plain") === "sk-legacy-plain");

// --- Wrong key: fails closed (no plaintext leak) ----------------------------
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
ok("wrong key: decrypt fails closed (empty)", decryptSecret(enc) === "");

// --- Invalid key length: treated as no key ----------------------------------
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
ok("short key: encryption disabled (passthrough)", !secretEncryptionEnabled() && encryptSecret("x") === "x");

console.log(`RESULT crypto-secrets: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
