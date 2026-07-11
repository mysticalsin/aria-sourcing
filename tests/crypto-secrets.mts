import { createCipheriv, createHash, randomBytes } from "node:crypto";

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

function legacyV1Ciphertext(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

const originalCurrentKey = process.env.DATA_ENCRYPTION_KEY;
const originalPreviousKeys = process.env.DATA_ENCRYPTION_PREVIOUS_KEYS;
const firstKey = Buffer.alloc(32, 7);
const secondKey = Buffer.alloc(32, 9);
const thirdKey = Buffer.alloc(32, 11);
const firstKeyB64 = firstKey.toString("base64");
const secondKeyB64 = secondKey.toString("base64");
const thirdKeyB64 = thirdKey.toString("base64");

// --- No key configured: backward-compatible passthrough ---------------------
delete process.env.DATA_ENCRYPTION_KEY;
delete process.env.DATA_ENCRYPTION_PREVIOUS_KEYS;
ok("no key: encryption reported disabled", !secretEncryptionEnabled());
ok("no key: encrypt passes plaintext through", encryptSecret("sk-abc") === "sk-abc");
ok("no key: decrypt passes plaintext through", decryptSecret("sk-abc") === "sk-abc");

// --- Current key: versioned envelope and real round-trip --------------------
process.env.DATA_ENCRYPTION_KEY = firstKeyB64;
ok("key: encryption reported enabled", secretEncryptionEnabled());
const enc = encryptSecret("sk-ant-secret-123");
const encParts = enc.split(":");
ok(
  "key: ciphertext carries a non-secret full SHA-256 key id in a v2 envelope",
  encParts.length === 6 &&
    encParts[0] === "enc" &&
    encParts[1] === "v2" &&
    encParts[2] === createHash("sha256").update(firstKey).digest("hex"),
);
ok("key: ciphertext differs from plaintext", enc !== "sk-ant-secret-123");
const sameKeyEnc = encryptSecret("another-secret");
ok("key: key id is stable while randomized ciphertext changes", sameKeyEnc.split(":")[2] === encParts[2] && sameKeyEnc !== enc);
ok("key: envelope never contains the base64 key material", !enc.includes(firstKeyB64));
ok("key: round-trips back to the plaintext", decryptSecret(enc) === "sk-ant-secret-123");
ok("key: legacy plaintext still passes through (mixed-state safe)", decryptSecret("sk-legacy-plain") === "sk-legacy-plain");

// --- Rotation: v2 selects an exact current or prior key ----------------------
process.env.DATA_ENCRYPTION_KEY = secondKeyB64;
process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify([firstKeyB64]);
ok("rotation: ciphertext written under the prior key still decrypts", decryptSecret(enc) === "sk-ant-secret-123");
const rotatedEnc = encryptSecret("sk-after-rotation");
ok("rotation: new writes use a different current-key id", rotatedEnc.split(":")[2] !== encParts[2]);
ok("rotation: new current-key ciphertext round-trips", decryptSecret(rotatedEnc) === "sk-after-rotation");

process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify([thirdKeyB64]);
ok("rotation: removing the matching prior key makes old v2 ciphertext fail closed", decryptSecret(enc) === "");

process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify([firstKeyB64]);
const unknownKeyId = `enc:v2:${"0".repeat(64)}:${encParts.slice(3).join(":")}`;
ok("v2: an unknown key id fails closed without trying unrelated keys", decryptSecret(unknownKeyId) === "");

// --- Legacy v1: all configured keys are tried during migration --------------
const legacyUnderFirstKey = legacyV1Ciphertext("legacy-before-rotation", firstKey);
const legacyUnderSecondKey = legacyV1Ciphertext("legacy-after-rotation", secondKey);
ok("v1 rotation: legacy ciphertext decrypts with a prior key", decryptSecret(legacyUnderFirstKey) === "legacy-before-rotation");
ok("v1 rotation: legacy ciphertext decrypts with the current key", decryptSecret(legacyUnderSecondKey) === "legacy-after-rotation");

// --- Malformed ciphertext: fail closed --------------------------------------
ok("ciphertext: unknown envelope versions fail closed", decryptSecret("enc:v99:not-plaintext") === "");
ok("ciphertext: v2 with extra fields fails closed", decryptSecret(`${rotatedEnc}:extra`) === "");
ok("ciphertext: v2 with a non-canonical iv fails closed", decryptSecret(rotatedEnc.replace(/:([^:]+):([^:]+):([^:]+)$/, ":$1x:$2:$3")) === "");
ok("ciphertext: v1 with a short authentication tag fails closed", decryptSecret(legacyUnderFirstKey.replace(/:([^:]+):([^:]+):([^:]+)$/, ":$1:AA==:$3")) === "");

// --- Malformed previous-key ring: reject the whole configuration ------------
const malformedRings: Array<[string, string]> = [
  ["invalid JSON", "not-json"],
  ["non-array JSON", JSON.stringify({ key: firstKeyB64 })],
  ["non-string entry", JSON.stringify([7])],
  ["non-canonical base64", JSON.stringify([firstKeyB64.replace(/=$/, "")])],
  ["duplicate previous keys", JSON.stringify([firstKeyB64, firstKeyB64])],
  ["current key duplicated as previous", JSON.stringify([secondKeyB64])],
  ["more than eight previous keys", JSON.stringify(Array.from({ length: 9 }, (_, index) => Buffer.alloc(32, index + 20).toString("base64")))],
];
for (const [label, value] of malformedRings) {
  process.env.DATA_ENCRYPTION_KEY = secondKeyB64;
  process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = value;
  ok(`ring: ${label} disables encryption`, !secretEncryptionEnabled());
  ok(`ring: ${label} refuses a secret write instead of leaking plaintext`, encryptSecret("must-not-leak") === "");
  ok(`ring: ${label} makes encrypted data fail closed`, decryptSecret(rotatedEnc) === "");
  ok(`ring: ${label} preserves legacy plaintext passthrough`, decryptSecret("sk-legacy-plain") === "sk-legacy-plain");
}

// --- Invalid key length: treated as no key ----------------------------------
delete process.env.DATA_ENCRYPTION_PREVIOUS_KEYS;
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
ok("short key: encryption disabled (passthrough)", !secretEncryptionEnabled() && encryptSecret("x") === "x");

// Existing current-key decoding remains backward compatible. Prior keys are
// deliberately stricter because their JSON ring is a new configuration surface.
process.env.DATA_ENCRYPTION_KEY = firstKeyB64.replace(/=$/, "");
ok("current key: legacy unpadded base64 remains accepted", secretEncryptionEnabled());
const unpaddedCurrentEnc = encryptSecret("current-key-compatibility");
ok(
  "current key: legacy unpadded base64 still encrypts and round-trips",
  unpaddedCurrentEnc.startsWith("enc:v2:") && decryptSecret(unpaddedCurrentEnc) === "current-key-compatibility",
);

if (originalCurrentKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
else process.env.DATA_ENCRYPTION_KEY = originalCurrentKey;
if (originalPreviousKeys === undefined) delete process.env.DATA_ENCRYPTION_PREVIOUS_KEYS;
else process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = originalPreviousKeys;

console.log(`RESULT crypto-secrets: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
