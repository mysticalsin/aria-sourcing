"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Shield, Monitor, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useActions, useSettings } from "@/lib/store";
import {
  BROWSER_AGENT_PERMISSION_MODES,
  LINKEDIN_DEFAULT_ALLOWED_HOSTS,
  normalizeAllowedHost,
  permissionModeHint,
  permissionModeLabel,
  saveBrowserAgentPermissions,
  type BrowserAgentPermissionMode,
} from "@/lib/browser-agent-permissions";
import { defaultFleetSettings } from "@/lib/fleet";

/**
 * Claude-in-Chrome options parity
 * (chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/options.html).
 * Mode is durable on FleetSettings (BE gates linkedin_send when Manual).
 */
export default function BrowserComputerOptionsPage() {
  const settings = useSettings();
  const actions = useActions();
  const fleet = settings.fleet ?? defaultFleetSettings();
  const mode: BrowserAgentPermissionMode =
    fleet.browserAgentPermissionMode === "manual" || fleet.browserAgentPermissionMode === "skip"
      ? fleet.browserAgentPermissionMode
      : "auto";

  const [allowedHosts, setAllowedHosts] = React.useState<string[]>([
    ...LINKEDIN_DEFAULT_ALLOWED_HOSTS,
  ]);
  const [pauseOnChallenge, setPauseOnChallenge] = React.useState(true);
  const [hostDraft, setHostDraft] = React.useState("");
  const [savedFlash, setSavedFlash] = React.useState(false);

  React.useEffect(() => {
    // Host allowlist stays browser-local (navigation UX); mode is workspace-durable.
    const cached = saveBrowserAgentPermissions({
      mode,
      allowedHosts,
      pauseOnChallenge,
    });
    setAllowedHosts(cached.allowedHosts);
    setPauseOnChallenge(cached.pauseOnChallenge);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from durable mode
  }, []);

  function flash() {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  }

  function setMode(next: BrowserAgentPermissionMode) {
    actions.updateSettings({
      fleet: { ...fleet, browserAgentPermissionMode: next },
    });
    saveBrowserAgentPermissions({ mode: next, allowedHosts, pauseOnChallenge });
    flash();
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
              Action approval is saved on the workspace fleet settings and enforced when Aria queues
              a LinkedIn Browser Computer send. Login/CAPTCHA still always pause for Take control.
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
            Saved — Manual mode is enforced on the server for linkedin_send.
          </p>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-sm font-semibold text-white">Action approval</h2>
          <p className="mt-1 text-xs text-slate-400">
            Matches Claude in Chrome’s Manually approve / Automatically approve / Skip approvals.
          </p>
          <div className="mt-4 space-y-2">
            {BROWSER_AGENT_PERMISSION_MODES.map((m) => {
              const selected = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex w-full flex-col rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-cyan-400/50 bg-cyan-400/10"
                      : "border-white/10 bg-black/20 hover:border-white/20"
                  }`}
                >
                  <span className="text-sm font-semibold text-white">{permissionModeLabel(m)}</span>
                  <span className="mt-1 text-xs leading-relaxed text-slate-400">
                    {permissionModeHint(m)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-sm font-semibold text-white">Approved sites</h2>
          <p className="mt-1 text-xs text-slate-400">
            Hosts the live desk may open while you watch. Defaults cover LinkedIn member + Recruiter.
          </p>
          <ul className="mt-3 space-y-2">
            {allowedHosts.map((host) => (
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
                    const next =
                      allowedHosts.filter((h) => h !== host).length > 0
                        ? allowedHosts.filter((h) => h !== host)
                        : [...LINKEDIN_DEFAULT_ALLOWED_HOSTS];
                    setAllowedHosts(next);
                    saveBrowserAgentPermissions({ mode, allowedHosts: next, pauseOnChallenge });
                    flash();
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
              if (allowedHosts.includes(host)) {
                setHostDraft("");
                return;
              }
              const next = [...allowedHosts, host];
              setAllowedHosts(next);
              saveBrowserAgentPermissions({ mode, allowedHosts: next, pauseOnChallenge });
              setHostDraft("");
              flash();
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
              checked={pauseOnChallenge}
              onChange={(e) => {
                setPauseOnChallenge(e.target.checked);
                saveBrowserAgentPermissions({
                  mode,
                  allowedHosts,
                  pauseOnChallenge: e.target.checked,
                });
                flash();
              }}
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
                <li>Approve outreach — Automatic mode types like a careful human on that seat.</li>
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
