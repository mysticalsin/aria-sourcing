"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Shield, Monitor, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import {
  BROWSER_AGENT_PERMISSION_MODES,
  LINKEDIN_DEFAULT_ALLOWED_HOSTS,
  loadBrowserAgentPermissions,
  normalizeAllowedHost,
  permissionModeHint,
  permissionModeLabel,
  saveBrowserAgentPermissions,
  type BrowserAgentPermissionMode,
  type BrowserAgentPermissions,
} from "@/lib/browser-agent-permissions";

/**
 * Claude-in-Chrome options parity
 * (chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/options.html).
 * Permission mode + LinkedIn host allowlist for Browser Computer seats.
 */
export default function BrowserComputerOptionsPage() {
  const [perms, setPerms] = React.useState<BrowserAgentPermissions | null>(null);
  const [hostDraft, setHostDraft] = React.useState("");
  const [savedFlash, setSavedFlash] = React.useState(false);

  React.useEffect(() => {
    setPerms(loadBrowserAgentPermissions());
  }, []);

  function persist(next: Partial<BrowserAgentPermissions> & { mode: BrowserAgentPermissionMode }) {
    const saved = saveBrowserAgentPermissions(next);
    setPerms(saved);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  }

  if (!perms) {
    return (
      <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#0b1220_0%,_#06080f_55%,_#05070c_100%)] px-4 py-10 text-slate-100">
        <p className="mx-auto max-w-2xl text-sm text-slate-400">Loading permissions…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#0b1220_0%,_#06080f_55%,_#05070c_100%)] text-slate-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
              Aria · Browser Computer · like Claude in Chrome
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Shield className="h-6 w-6 text-cyan-300" aria-hidden />
              Permissions
            </h1>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">
              Same idea as Claude’s Chrome extension options: choose how Aria may act on LinkedIn
              seats you already own, and which hosts the bot may open. Login/CAPTCHA still always
              pause for Take control — we never invent a healthy session.
            </p>
          </div>
          <Link
            href="/fleet"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Fleet
          </Link>
        </div>

        {savedFlash ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Saved on this browser.
          </p>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-sm font-semibold text-white">Action approval</h2>
          <p className="mt-1 text-xs text-slate-400">
            Matches Claude in Chrome’s Manually approve / Automatically approve / Skip approvals.
          </p>
          <div className="mt-4 space-y-2">
            {BROWSER_AGENT_PERMISSION_MODES.map((mode) => {
              const selected = perms.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => persist({ ...perms, mode })}
                  className={`flex w-full flex-col rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-cyan-400/50 bg-cyan-400/10"
                      : "border-white/10 bg-black/20 hover:border-white/20"
                  }`}
                >
                  <span className="text-sm font-semibold text-white">{permissionModeLabel(mode)}</span>
                  <span className="mt-1 text-xs leading-relaxed text-slate-400">
                    {permissionModeHint(mode)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-sm font-semibold text-white">Approved sites</h2>
          <p className="mt-1 text-xs text-slate-400">
            Bot navigation stays on these hosts. Defaults cover LinkedIn member + Recruiter.
          </p>
          <ul className="mt-3 space-y-2">
            {perms.allowedHosts.map((host) => (
              <li
                key={host}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm"
              >
                <span className="font-mono text-slate-200">{host}</span>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-rose-300"
                  aria-label={`Remove ${host}`}
                  onClick={() => {
                    const next = perms.allowedHosts.filter((h) => h !== host);
                    persist({
                      ...perms,
                      allowedHosts:
                        next.length > 0 ? next : [...LINKEDIN_DEFAULT_ALLOWED_HOSTS],
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              const host = normalizeAllowedHost(hostDraft);
              if (!host) return;
              if (perms.allowedHosts.includes(host)) {
                setHostDraft("");
                return;
              }
              persist({ ...perms, allowedHosts: [...perms.allowedHosts, host] });
              setHostDraft("");
            }}
          >
            <input
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              placeholder="talent.linkedin.com"
              className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-cyan-400/40 focus:ring"
            />
            <Button type="submit" size="sm" variant="secondary">
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Add host
            </Button>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={perms.pauseOnChallenge}
              onChange={(e) => persist({ ...perms, pauseOnChallenge: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-semibold text-white">
                Always pause on login / CAPTCHA / checkpoint
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                Recommended. Aria refuses to invent <code className="text-slate-300">sessionHealthy</code>{" "}
                and asks you to Take control when LinkedIn challenges the seat.
              </span>
            </span>
          </label>
        </section>

        <section className="rounded-2xl border border-dashed border-white/15 bg-black/20 p-5">
          <div className="flex items-start gap-3">
            <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden />
            <div className="text-sm text-slate-300">
              <p className="font-semibold text-white">How to use it (Claude Chrome feel)</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-400">
                <li>Open a seat’s live viewport (Fleet → Computers → Observe).</li>
                <li>Watch the agent work; press <kbd className="text-slate-200">T</kbd> to Take control.</li>
                <li>Finish LinkedIn login / CAPTCHA yourself; press Esc to Get out · Release.</li>
                <li>Approve outreach in Aria — Automatic mode types like a careful human on that seat.</li>
              </ol>
              <Link
                href="/fleet"
                className="mt-3 inline-flex text-xs font-semibold text-cyan-300 hover:text-cyan-200"
              >
                Open Fleet computers →
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
