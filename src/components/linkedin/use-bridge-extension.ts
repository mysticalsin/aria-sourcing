"use client";

import * as React from "react";
import type { ExtensionStatus } from "./types";

/* The ARIA LinkedIn Bridge extension injects a small relay into this page
 * (extensions/linkedin-bridge/aria-page.js). Messages go through
 * window.postMessage on this origin only; the extension itself checks that
 * the page is the ARIA address it is set up for. */

const FROM_PAGE = "aria-linkedin-page";
const FROM_EXTENSION = "aria-linkedin-extension";
const LIVE_PING_MS = 15_000;

function post(message: Record<string, unknown>) {
  window.postMessage({ source: FROM_PAGE, ...message }, window.location.origin);
}

function readStatus(raw: unknown): ExtensionStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  return {
    version: typeof s.version === "string" ? s.version : "",
    paired: s.paired === true,
    state: typeof s.state === "string" ? s.state : "idle",
    running: s.running === true,
    message: typeof s.message === "string" ? s.message : "",
    sessionPresent: s.sessionPresent === true,
    accountName: typeof s.accountName === "string" ? s.accountName : null,
    lastPollAt: typeof s.lastPollAt === "number" ? s.lastPollAt : null,
  };
}

export interface BridgeExtension {
  /** The extension answered on this page. */
  detected: boolean;
  status: ExtensionStatus | null;
  /** Hand a fresh pairing code to the extension (one-click pairing). */
  pair: (token: string) => Promise<{ ok: boolean; error?: string }>;
  /** Ask the extension to sync now (after a send, on opening a thread). */
  nudge: () => void;
}

/** `live`: tell the extension this inbox is open and visible (faster sync). */
export function useBridgeExtension(live: boolean): BridgeExtension {
  const [status, setStatus] = React.useState<ExtensionStatus | null>(null);
  const pending = React.useRef<((answer: { ok: boolean; error?: string }) => void) | null>(null);

  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== FROM_EXTENSION) return;
      if (data.type === "status") {
        const next = readStatus(data.status);
        if (next) setStatus(next);
      } else if (data.type === "paired" && pending.current) {
        pending.current({ ok: data.ok === true, error: typeof data.error === "string" ? data.error : undefined });
        pending.current = null;
      }
    }
    window.addEventListener("message", onMessage);
    post({ type: "hello" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  React.useEffect(() => {
    if (!live) return;
    const ping = () => {
      if (document.visibilityState === "visible") post({ type: "live" });
    };
    ping();
    const timer = window.setInterval(ping, LIVE_PING_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [live]);

  const pair = React.useCallback(
    (token: string) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const timer = window.setTimeout(() => {
          pending.current = null;
          resolve({ ok: false, error: "The extension did not answer." });
        }, 5000);
        pending.current = (answer) => {
          window.clearTimeout(timer);
          resolve(answer);
        };
        post({ type: "pair", token });
      }),
    [],
  );

  const nudge = React.useCallback(() => post({ type: "nudge" }), []);

  return { detected: status !== null, status, pair, nudge };
}
