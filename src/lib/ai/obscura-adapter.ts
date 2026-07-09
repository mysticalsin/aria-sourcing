// Owns the Obscura sidecar connection: a single shared CDP browser link, a
// session table of isolated per-call browser contexts, and an idle/hard-timeout
// sweeper. This is the ONLY module that talks to the sidecar; src/lib/ai/browser-tools.ts
// is the tool-facing layer that enforces the restricted action vocabulary, SSRF
// guard, and robots.txt check on top of the sessions this module hands out.
//
// See docs/superpowers/specs/2026-06-27-claw3d-office-merge-design.md §11.3.
// Note: unlike that spec's `server/obscura-adapter.js` (a standalone process,
// assumed by a custom-server architecture this repo doesn't have), this module
// lives in-process with the rest of the Next.js server code -- there's no
// second process to talk to over a loopback HTTP API, so this exports plain
// functions instead.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { randomUUID } from "node:crypto";

const OBSCURA_HTTP_URL = process.env.OBSCURA_URL || "http://127.0.0.1:9222";
// Obscura's /json/version always advertises `ws://127.0.0.1:<port>/devtools/browser`
// in webSocketDebuggerUrl, regardless of the --host it was started with (it hardcodes
// 127.0.0.1 rather than reflecting the request's Host header). Playwright's HTTP-discovery
// form of connectOverCDP trusts that advertised URL verbatim, which breaks the moment the
// caller isn't in the same network namespace as the sidecar (e.g. a sibling container
// reaching it by service name). Connecting straight to the well-known ws:// path sidesteps
// the HTTP discovery step -- and the bad host it would return -- entirely.
const OBSCURA_WS_URL = `${OBSCURA_HTTP_URL.replace(/^http/, "ws").replace(/\/$/, "")}/devtools/browser`;
export const IDLE_TIMEOUT_MS = 60_000;
export const HARD_TIMEOUT_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 15_000;

export interface ObscuraSession {
  id: string;
  context: BrowserContext;
  page: Page;
  openedAt: number;
  lastActivityAt: number;
}

const sessions = new Map<string, ObscuraSession>();

let browserPromise: Promise<Browser> | null = null;
let sweeperHandle: ReturnType<typeof setInterval> | null = null;

/** Fresh connection to the sidecar (memoized); resets on disconnect so the next call retries. */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .connectOverCDP(OBSCURA_WS_URL)
      .then((browser) => {
        browser.once("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

/** Pure expiry check, exported so the sweeper's timing logic is unit-testable without a real sidecar. */
export function isSessionExpired(
  session: Pick<ObscuraSession, "openedAt" | "lastActivityAt">,
  now: number,
): boolean {
  const idleExpired = now - session.lastActivityAt > IDLE_TIMEOUT_MS;
  const hardExpired = now - session.openedAt > HARD_TIMEOUT_MS;
  return idleExpired || hardExpired;
}

function ensureSweeper(): void {
  if (sweeperHandle) return;
  sweeperHandle = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (isSessionExpired(session, now)) {
        void closeObscuraSession(session.id);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweeperHandle.unref?.();
}

/** Open a new, cookie-empty browser session. Throws on sidecar connect failure -- callers translate to a ToolResult. */
export async function openObscuraSession(): Promise<ObscuraSession> {
  ensureSweeper();
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: "ARIAResearchBot/1.0" });
  const page = await context.newPage();
  const now = Date.now();
  const session: ObscuraSession = { id: randomUUID(), context, page, openedAt: now, lastActivityAt: now };
  sessions.set(session.id, session);
  return session;
}

/** Look up a live session and refresh its idle clock. Returns undefined if unknown/expired. */
export function touchObscuraSession(id: string): ObscuraSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.lastActivityAt = Date.now();
  return session;
}

/** Explicit early close (idle/hard timeout closes it anyway). Safe to call on an unknown id. */
export async function closeObscuraSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  await session.context.close().catch(() => {});
}

/** Test-only: number of live sessions, so the sweeper can be exercised without a real sidecar. */
export function _debugSessionCount(): number {
  return sessions.size;
}
