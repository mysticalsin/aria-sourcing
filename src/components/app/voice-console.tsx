"use client";

/* ============================================================================
   Voice Console ("Hey Aria") — a push-to-talk front end over the SAME
   deterministic Aria Command grammar + gated execution path the ⌘K console
   uses (src/lib/aria-command.ts + store.ts's runAriaPlan). This file owns
   ONLY the UI: parsing lives in src/lib/voice/intent.ts, STT/TTS live in
   src/lib/voice/aria-voice.ts.

   Safety contract (read before touching):
   - Every recognized/typed instruction is parsed with the exact same
     parseCommand() the Aria Command console uses. An empty/unactionable
     parse is NEVER dispatched — it only ever shows the "didn't catch an
     actionable command" state.
   - The only way this component ever mutates anything is
     `actions.runAriaPlan(plan, onStep)` — the same drafts-only, gated path
     the ⌘K console dispatches through. There is no other action call in this
     file, and none should ever be added.
   - Speech recognition is opt-in (off by default) and Chromium-only; the
     caveat is always visible next to the toggle. Typed input and spoken
     replies both work with zero network in every browser.
   ========================================================================== */

import * as React from "react";
import { AlertTriangle, Mic, MicOff, PlayCircle, ShieldCheck, Volume2 } from "lucide-react";
import { Badge, Button, Input, Modal, Switch } from "@/components/ui";
import { useActions, useCampaigns } from "@/lib/store";
import type { AriaPlan } from "@/lib/aria-command";
import { navHrefForPlan, resolveVoiceIntent } from "@/lib/voice/intent";
import { isSTTSupported, isTTSSupported, speak, startListening, stopListening } from "@/lib/voice/aria-voice";

type StepStatus = "idle" | "running" | "done" | "failed";
type StepResult = { count?: number; detail?: string };
type RunPhase = "idle" | "running" | "settled" | "rejected";

export interface VoiceConsoleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STT_UNSUPPORTED_MESSAGE =
  "Voice input isn't available in this browser. Speech recognition only works in Chromium-based browsers (Chrome, Edge); type your instruction below instead.";

const REJECTED_MESSAGE =
  "Didn't catch an actionable command. Try naming an action (source, draft, follow up, book, pool, report) plus a role or campaign.";

/** DOM-only nav "flash": Sidebar/mobile-nav belong to other work in this
 *  phase, so this reaches their rendered `<a href>` the same way a plain
 *  scoped querySelector would — a self-reverting inline style, never a class
 *  or a file edit outside this component. Scoped to `nav[aria-label^="Primary"]`
 *  so it can only ever touch a real nav link (desktop Sidebar or the mobile
 *  bottom nav), never an unrelated in-page link that happens to share the
 *  href. Respects prefers-reduced-motion by shortening the flash to a near
 *  -instant blip instead of skipping the (already load-bearing, since it's
 *  the only user-visible confirmation of "where to look") feedback entirely. */
function flashNavItem(href: string): void {
  if (typeof document === "undefined") return;
  try {
    const reduceMotion =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 120 : 900;
    const hold = reduceMotion ? 60 : 550;
    document.querySelectorAll<HTMLAnchorElement>(`a[href="${CSS.escape(href)}"]`).forEach((el) => {
      if (!el.closest('nav[aria-label^="Primary"]')) return;
      const prevBoxShadow = el.style.boxShadow;
      const prevTransition = el.style.transition;
      el.style.transition = `box-shadow ${duration}ms ease-out`;
      el.style.boxShadow = "0 0 0 3px hsl(var(--electric) / 0.55)";
      window.setTimeout(() => {
        el.style.boxShadow = prevBoxShadow;
        window.setTimeout(() => {
          el.style.transition = prevTransition;
        }, duration);
      }, hold);
    });
  } catch {
    /* purely cosmetic — never let a DOM quirk break the voice flow */
  }
}

/** One-line, speakable wrap-up built from the plan + the real per-step
 *  results runAriaPlan reported — never a canned string, always what
 *  actually happened. Mirrors the "0 sent" framing the ⌘K console's own
 *  settled banner uses. */
function buildSettledMessage(plan: AriaPlan, statuses: StepStatus[], results: StepResult[]): string {
  const bits = plan.steps.map((step, i) => {
    const count = results[i]?.count;
    const label = step.verb.replace("-", " ");
    return typeof count === "number" ? `${count} ${label}` : label;
  });
  const anyFailed = statuses.some((s) => s === "failed");
  const lead = anyFailed ? "Ran with some issues" : "Done";
  return `${lead}: ${bits.join(", ")}. Drafts are waiting for approval, nothing sent.`;
}

export function VoiceConsole({ open, onOpenChange }: VoiceConsoleProps) {
  const campaigns = useCampaigns();
  const actions = useActions();

  // Feature detection is stable for the life of a browser session — compute
  // once rather than re-probing on every render.
  const sttSupported = React.useMemo(() => isSTTSupported(), []);
  const ttsSupported = React.useMemo(() => isTTSSupported(), []);

  const [sttEnabled, setSttEnabled] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [typedText, setTypedText] = React.useState("");
  const [voiceError, setVoiceError] = React.useState<string | null>(null);

  const [phase, setPhase] = React.useState<RunPhase>("idle");
  const [plan, setPlan] = React.useState<AriaPlan | null>(null);
  const [statuses, setStatuses] = React.useState<StepStatus[]>([]);
  const [results, setResults] = React.useState<StepResult[]>([]);
  const [settledMessage, setSettledMessage] = React.useState<string | null>(null);

  // Never leave the mic listening in the background — stop on close/unmount.
  React.useEffect(() => {
    if (!open) stopListening();
    return () => stopListening();
  }, [open]);

  const dispatchInstruction = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSettledMessage(null);

      const intent = resolveVoiceIntent(trimmed, campaigns);
      setPlan(intent.plan);

      if (!intent.actionable) {
        setPhase("rejected");
        setStatuses([]);
        setResults([]);
        speak("Didn't catch an actionable command.");
        return;
      }

      setPhase("running");
      setStatuses(intent.plan.steps.map(() => "idle"));
      setResults(intent.plan.steps.map(() => ({})));

      const stepStatuses: StepStatus[] = intent.plan.steps.map(() => "idle");
      const stepResults: StepResult[] = intent.plan.steps.map(() => ({}));

      try {
        // Dispatches through the SAME gated, drafts-only path as the ⌘K Aria
        // Command console — never a raw send. See runAriaPlan in store.ts.
        await actions.runAriaPlan(intent.plan, (i, status, result) => {
          stepStatuses[i] = status;
          if (result) stepResults[i] = result;
          setStatuses((prev) => {
            const next = [...prev];
            next[i] = status;
            return next;
          });
          if (result) {
            setResults((prev) => {
              const next = [...prev];
              next[i] = result;
              return next;
            });
          }
        });
      } finally {
        const message = buildSettledMessage(intent.plan, stepStatuses, stepResults);
        setSettledMessage(message);
        setPhase("settled");
        speak(message);
        const href = navHrefForPlan(intent.plan);
        if (href) flashNavItem(href);
      }
    },
    [actions, campaigns],
  );

  const handleListenToggle = React.useCallback(() => {
    if (!sttSupported) {
      setVoiceError(STT_UNSUPPORTED_MESSAGE);
      return;
    }
    if (listening) {
      stopListening();
      setListening(false);
      return;
    }
    setVoiceError(null);
    setTranscript("");
    setListening(true);
    startListening(
      (text, isFinal) => {
        setTranscript(text);
        if (isFinal) {
          setListening(false);
          void dispatchInstruction(text);
        }
      },
      (message) => {
        setVoiceError(message);
        setListening(false);
      },
    );
  }, [sttSupported, listening, dispatchInstruction]);

  const handleTypedSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = typedText;
      if (!text.trim()) return;
      setTypedText("");
      void dispatchInstruction(text);
    },
    [typedText, dispatchInstruction],
  );

  const running = phase === "running";
  const hasSteps = !!plan && plan.steps.length > 0;

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Hey Aria"
      description="Push-to-talk voice ops: speak or type one instruction. Aria runs it through the same drafts-only plan as Aria Command."
      className="max-w-xl"
      footer={
        <p className="flex w-full items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          Drafts only. Voice can never send; every run halts at the approval queue.
        </p>
      }
    >
      <div className="space-y-4">
        {/* Opt-in STT toggle — off by default, Chromium caveat always visible. */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Enable voice (Chromium)</p>
            <p className="mt-0.5 text-xs text-muted">
              Speech recognition only works in Chromium-based browsers (Chrome, Edge). Typed instructions and spoken
              replies work everywhere below, with zero network calls.
            </p>
          </div>
          <Switch
            checked={sttEnabled}
            onCheckedChange={(v) => {
              setSttEnabled(v);
              if (!v && listening) {
                stopListening();
                setListening(false);
              }
            }}
            label="Enable voice input"
          />
        </div>

        {/* Mic + live transcript chip — only rendered once opted in. */}
        {sttEnabled && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant={listening ? "danger" : "gradient"}
                size="icon"
                onClick={handleListenToggle}
                disabled={!sttSupported || running}
                aria-pressed={listening}
                aria-label={listening ? "Stop listening" : "Start listening"}
                leftIcon={listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              />
              <p className="text-sm text-ink-soft">
                {!sttSupported
                  ? STT_UNSUPPORTED_MESSAGE
                  : listening
                    ? "Listening…"
                    : "Press the mic and speak an instruction."}
              </p>
            </div>
            {transcript && (
              <p className="rounded-2xl bg-electric-soft px-3.5 py-2.5 text-sm font-medium text-electric">“{transcript}”</p>
            )}
            {voiceError && (
              <p className="flex items-center gap-1.5 text-xs text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {voiceError}
              </p>
            )}
          </div>
        )}

        {/* Typed fallback — always available, works with zero network and no STT. */}
        <form onSubmit={handleTypedSubmit} className="flex items-center gap-2">
          <Input
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder='Type an instruction, e.g. "source twenty backend engineers and draft outreach"'
            aria-label="Typed instruction"
            disabled={running}
          />
          <Button
            type="submit"
            size="icon"
            variant="secondary"
            disabled={running || !typedText.trim()}
            aria-label="Run instruction"
            leftIcon={<PlayCircle className="h-5 w-5" />}
          />
        </form>

        {!ttsSupported && (
          <p className="text-xs text-muted">Spoken replies aren't supported in this browser. Summaries still show as text below.</p>
        )}

        {phase === "rejected" && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-warning-soft px-3.5 py-3 text-sm text-[hsl(32_90%_34%)] ring-1 ring-inset ring-warning/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{REJECTED_MESSAGE}</span>
          </div>
        )}

        {hasSteps && plan && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">{plan.summary}</p>
            <ol className="space-y-1.5" aria-label="Voice command plan">
              {plan.steps.map((step, i) => {
                const status = statuses[i] ?? "idle";
                return (
                  <li key={`${step.verb}-${i}`} className="flex items-center gap-2 text-xs text-ink-soft">
                    <Badge
                      size="sm"
                      tone={
                        status === "done"
                          ? "success"
                          : status === "failed"
                            ? "danger"
                            : status === "running"
                              ? "electric"
                              : "neutral"
                      }
                    >
                      {status}
                    </Badge>
                    {step.label}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {phase === "settled" && settledMessage && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-success-soft px-3.5 py-3 text-sm text-success ring-1 ring-inset ring-success/20">
            <Volume2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{settledMessage}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
