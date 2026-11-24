import { createHash, randomBytes } from "node:crypto";

/* Pairing tokens for the LinkedIn bridge extension. Only the SHA-256 hash is
 * stored; the token itself is shown once, when the user pairs the extension. */

export const BRIDGE_TOKEN_PREFIX = "aria_lnb_";
const TOKEN_PATTERN = /^aria_lnb_[A-Za-z0-9_-]{43}$/;

export function generateBridgeToken(): { token: string; hash: string } {
  const token = `${BRIDGE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashBridgeToken(token) };
}

export function hashBridgeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The token of an "Authorization: Bearer aria_lnb_..." header, or null. */
export function bridgeTokenFromHeader(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

/** 16 random alphanumeric characters (LinkedIn's client trackingId). */
export function randomTrackingId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
