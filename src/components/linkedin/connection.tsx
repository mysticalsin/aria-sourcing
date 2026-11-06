"use client";

import * as React from "react";
import { AlertTriangle, Check, Copy, KeyRound, Linkedin, Loader2, MoreHorizontal, Plug, Puzzle, RefreshCw, Unplug, UserCheck } from "lucide-react";
import { Button, Card, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ago, useNow } from "./format";
import type { AccountInfo, ExtensionStatus, Policy } from "./types";
import type { Transport } from "./use-linkedin-inbox";

type Live = "syncing" | "live" | "no-session" | "offline" | "waiting";

function liveState(account: AccountInfo | null, extension: ExtensionStatus | null): Live {
  if (extension?.running) return "syncing";
  if (!account?.lastSeenAt) return "waiting";
  if (!account.online) return "offline";
  return account.sessionPresent ? "live" : "no-session";
}

const LIVE_LABEL: Record<Live, string> = {
  syncing: "Syncing with LinkedIn",
  live: "Live",
  "no-session": "Not signed in to LinkedIn",
  offline: "Extension offline",
  waiting: "Waiting for the extension",
};

function StatusPill({ state }: { state: Live }) {
  const tone =
    state === "live"
      ? "bg-success-soft text-success ring-success/25"
      : state === "syncing"
        ? "bg-electric-soft text-electric ring-electric/25"
        : "bg-warning-soft text-[hsl(32_90%_34%)] ring-warning/30";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", tone)} aria-live="polite">
      {state === "syncing" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <span className={cn("h-2 w-2 rounded-full bg-current", state === "live" && "status-live")} aria-hidden />
      )}
      {LIVE_LABEL[state]}
    </span>
  );
}

function CodeBox({ token }: { token: string }) {
  const { toast } = useToast();
  return (
    <div className="mt-4 rounded-xl border border-line bg-ink/[0.03] p-4 text-sm animate-fade-in">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <KeyRound className="h-4 w-4 text-electric" aria-hidden /> Pairing code (shown once)
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={token}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 font-mono text-xs text-ink"
          aria-label="Pairing code"
        />
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Copy className="h-4 w-4" />}
          onClick={() => void navigator.clipboard.writeText(token).then(() => toast({ title: "Pairing code copied.", variant: "success" }))}
        >
          Copy
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">Paste it in the extension popup (Settings › Pairing code), then Save.</p>
    </div>
  );
}

/** Not paired yet: three steps, the last one a single click when the extension is here. */
export function Onboarding({
  extension,
  connecting,
  manualToken,
  onConnect,
}: {
  extension: { detected: boolean; status: ExtensionStatus | null };
  connecting: boolean;
  manualToken: string | null;
  onConnect: (viaExtension: boolean) => void;
}) {
  const steps = [
    {
      icon: Puzzle,
      title: "Install the ARIA extension in Chrome",
      done: extension.detected,
      body: extension.detected ? (
        `Detected in this browser (v${extension.status?.version}).`
      ) : (
        <>
          <span className="font-mono">chrome://extensions</span> › Developer mode › <b>Load unpacked</b> ›{" "}
          <span className="font-mono">extensions/linkedin-bridge</span>, then reload this page. Already installed? Click its reload arrow so it
          can talk to this page.
        </>
      ),
    },
    {
      icon: UserCheck,
      title: "Stay signed in to LinkedIn",
      done: Boolean(extension.status?.sessionPresent),
      body: extension.status?.sessionPresent ? "LinkedIn session found in this browser." : "In the same Chrome profile, on linkedin.com.",
    },
    {
      icon: Plug,
      title: "Connect",
      done: false,
      body: "ARIA creates a pairing code and hands it to the extension. Nothing to copy.",
    },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-hidden border-b border-line bg-gradient-to-br from-violet/10 via-electric/5 to-aqua/10 px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0a66c2] text-white shadow-lg shadow-[#0a66c2]/30">
            <Linkedin className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">Bring your LinkedIn inbox into ARIA</h2>
            <p className="text-sm text-muted">Read replies next to your candidates and answer them from here, as yourself.</p>
          </div>
        </div>
      </div>
      <ol className="divide-y divide-line">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-4 px-6 py-4">
            <span
              className={cn(
                "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-[background-color,color] duration-300 ease-motion-out",
                step.done ? "bg-success text-white" : "bg-ink/[0.06] text-ink-soft",
              )}
            >
              {step.done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <step.icon className="h-4 w-4 text-muted" aria-hidden /> {step.title}
              </p>
              <p className="mt-0.5 text-sm text-muted">{step.body}</p>
              {i === 2 && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    variant="gradient"
                    leftIcon={<Plug className="h-4 w-4" />}
                    loading={connecting}
                    disabled={!extension.detected}
                    onClick={() => onConnect(true)}
                  >
                    Connect in one click
                  </Button>
                  <button type="button" className="text-xs font-semibold text-muted underline-offset-2 hover:underline" onClick={() => onConnect(false)}>
                    Use a pairing code instead
                  </button>
                </div>
              )}
              {i === 2 && manualToken && <CodeBox token={manualToken} />}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Paired: live status, counters and the few account actions. */
export function ConnectionBar({
  account,
  policy,
  unread,
  extension,
  transport,
  manualToken,
  onReconnect,
  onNewCode,
  onDisconnect,
  onSync,
}: {
  account: AccountInfo | null;
  policy: Policy;
  unread: number;
  extension: { detected: boolean; status: ExtensionStatus | null };
  transport: Transport;
  manualToken: string | null;
  onReconnect: () => void;
  onNewCode: () => void;
  onDisconnect: () => void;
  onSync: () => void;
}) {
  const now = useNow(1000);
  const [menu, setMenu] = React.useState(false);
  const state = liveState(account, extension.status);
  const needsReconnect = extension.detected && extension.status !== null && !extension.status.paired;
  const sentPct = policy.dailySendCap ? Math.min(100, (policy.sentLast24h / policy.dailySendCap) * 100) : 0;
  return (
    <Card className="mb-4 px-5 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0a66c2] text-white shadow-md shadow-[#0a66c2]/25">
            <Linkedin className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-ink">{account?.displayName ?? "LinkedIn"}</span>
              <StatusPill state={state} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted" suppressHydrationWarning>
              {account?.lastInboxSyncAt ? `Inbox synced ${ago(account.lastInboxSyncAt, now)}` : "First sync pending"}
              {account?.extensionVersion ? ` · extension ${account.extensionVersion}` : ""}
              {transport === "live" ? " · real-time" : transport === "polling" ? " · refreshing every 10 s" : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-3 lg:justify-end">
          <div className="text-sm">
            <span className="text-lg font-bold tabular-nums text-ink">{unread}</span>
            <span className="ml-1.5 text-muted">unread</span>
          </div>
          <div className="w-40">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted">Sent in 24 h</span>
              <span className="font-semibold tabular-nums text-ink">
                {policy.sentLast24h}/{policy.dailySendCap}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={Math.round(sentPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Messages sent in the last 24 hours">
              <div
                className="motion-progress-fill h-full origin-left rounded-full bg-gradient-to-r from-violet to-electric transition-transform duration-500 ease-motion-out"
                style={{ transform: `scaleX(${sentPct / 100})` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {needsReconnect ? (
              <Button size="sm" variant="gradient" leftIcon={<Plug className="h-4 w-4" />} onClick={onReconnect}>
                Connect this browser
              </Button>
            ) : (
              <Button size="sm" variant="outline" leftIcon={<RefreshCw className={cn("h-4 w-4", state === "syncing" && "animate-spin")} />} onClick={onSync}>
                Sync now
              </Button>
            )}
            <div className="relative">
              <Button size="icon" variant="ghost" aria-label="More" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
              {menu && (
                <div className="absolute right-0 top-10 z-20 w-52 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-xl animate-scale-in" onMouseLeave={() => setMenu(false)}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink/5" onClick={() => { setMenu(false); onNewCode(); }}>
                    <KeyRound className="h-4 w-4 text-muted" /> New pairing code
                  </button>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-danger hover:bg-danger/5" onClick={() => { setMenu(false); onDisconnect(); }}>
                    <Unplug className="h-4 w-4" /> Disconnect and delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {(account?.lastError || state === "offline" || state === "no-session") && (
        <p
          className={cn(
            "mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm animate-fade-in",
            account?.lastError ? "bg-danger-soft text-danger" : "bg-warning-soft text-ink",
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {account?.lastError ??
            (state === "offline"
              ? `The extension was last seen ${ago(account?.lastSeenAt ?? null, now)}. Open Chrome with the ARIA extension: queued messages leave as soon as it is back.`
              : "The extension is running but this browser is not signed in to LinkedIn. Sign in on linkedin.com.")}
        </p>
      )}
      {manualToken && <CodeBox token={manualToken} />}
    </Card>
  );
}
