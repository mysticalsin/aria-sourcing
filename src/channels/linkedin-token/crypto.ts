import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface Env {
  lookup(key: string): string | undefined;
}

const KEY_NAME = "ARIA_LINKEDIN_TOKEN_KEY";

function keyFrom(env: Env): Buffer {
  const raw = env.lookup(KEY_NAME);
  if (!raw) throw new Error(`${KEY_NAME} is not set`);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new Error(`${KEY_NAME} is not set`);
  }
  if (decoded.length !== 32 || decoded.toString("base64") !== raw) {
    throw new Error(`${KEY_NAME} is not set`);
  }
  return decoded;
}

/** AES-256-GCM. A new random nonce is used for every call. */
export function encryptToken(plaintext: string, env: Env): string {
  const key = keyFrom(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(stored: string, env: Env): string {
  const key = keyFrom(env);
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("token ciphertext rejected");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("token ciphertext rejected");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("token ciphertext rejected");
  }
}
