import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import type { HubCompatibilityReport } from "./types";

/**
 * Signed report tokens for candidate-facing diagnostic pages.
 * Uses DATA_ENCRYPTION_KEY (already on Fly) or CANDIDATE_HUB_SECRET.
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hubSecret(): string {
  const dedicated = (process.env.CANDIDATE_HUB_SECRET ?? "").trim();
  if (dedicated.length >= 16) return dedicated;
  const enc = (process.env.DATA_ENCRYPTION_KEY ?? "").trim();
  if (enc.length >= 16) return enc;
  return "";
}

export function candidateHubSigningReady(): boolean {
  return hubSecret().length >= 16;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", hubSecret()).update(payloadB64).digest("base64url");
}

export function mintHubReportToken(report: HubCompatibilityReport): string | null {
  if (!candidateHubSigningReady()) return null;
  const envelope = {
    exp: Date.now() + TTL_MS,
    nonce: randomBytes(8).toString("hex"),
    report,
  };
  const payload = b64url(JSON.stringify(envelope));
  return `${payload}.${sign(payload)}`;
}

export function verifyHubReportToken(token: string | undefined | null): HubCompatibilityReport | null {
  if (!token || !candidateHubSigningReady()) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const raw = Buffer.from(payload, "base64url").toString("utf8");
    const envelope = JSON.parse(raw) as { exp?: number; report?: HubCompatibilityReport };
    if (!envelope.exp || envelope.exp < Date.now() || !envelope.report?.reportId) return null;
    if (envelope.report.screeningMode !== "async_text") return null;
    return envelope.report;
  } catch {
    return null;
  }
}
