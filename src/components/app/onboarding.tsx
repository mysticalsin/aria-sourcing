"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Modal, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ONBOARDING_TOUR_STEPS } from "@/lib/command-center-firstrun";
import { Sparkles, ShieldCheck, FilePlus2, ArrowLeft } from "lucide-react";

const KEY = "hermes:onboarded:v1";

const STEP_ICONS = [
  <Sparkles key="welcome" className="h-6 w-6" />,
  <ShieldCheck key="control" className="h-6 w-6" />,
  <FilePlus2 key="start" className="h-6 w-6" />,
] as const;

/**
 * First-run guided tour. Shows once per browser (localStorage flag) and can be
 * skipped at any step. Mounted in the app shell so it appears on first load of
 * any page. Persistence is client-only, so it never touches the workspace state.
 *
 * Copy is consumer-grade (see ONBOARDING_TOUR_STEPS) — no fleet/soul/ops jargon.
 * Finishing on the last step routes to Intake so the next click is obvious.
 */
export function Onboarding() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      /* private mode — skip the tour silently */
    }
  }, []);

  const finish = React.useCallback(
    (opts?: { goToIntake?: boolean }) => {
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* ignore */
      }
      setOpen(false);
      if (opts?.goToIntake) {
        router.push("/intake");
      }
    },
    [router],
  );

  const s = ONBOARDING_TOUR_STEPS[step] ?? ONBOARDING_TOUR_STEPS[0];
  const isLast = step === ONBOARDING_TOUR_STEPS.length - 1;

  return (
    <Modal
      open={open}
      onClose={() => finish()}
      title={s.title}
      description={`Step ${step + 1} of ${ONBOARDING_TOUR_STEPS.length}`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="subtle" size="sm" onClick={() => finish()}>
            Skip
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button
                variant="subtle"
                size="sm"
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                onClick={() => setStep((v) => v - 1)}
              >
                Back
              </Button>
            )}
            {isLast ? (
              <Button variant="primary" size="sm" onClick={() => finish({ goToIntake: true })}>
                Paste a job brief
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setStep((v) => v + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-electric to-violet text-white shadow-glow-purple">
          {STEP_ICONS[step] ?? STEP_ICONS[0]}
        </div>
        <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
        <div className="flex gap-1.5" aria-hidden>
          {ONBOARDING_TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step ? "w-6 bg-electric" : "w-1.5 bg-ink/15",
              )}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
