"use client";

import * as React from "react";
import { Modal, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Sparkles, Building2, Bot, SlidersHorizontal, ArrowLeft } from "lucide-react";

const KEY = "hermes:onboarded:v1";

type Step = { icon: React.ReactNode; title: string; body: string };

const STEPS: Step[] = [
  {
    icon: <Sparkles className="h-6 w-6" />,
    title: "Welcome to Aria Sourcing",
    body:
      "Autonomous recruiting operations by Mantu. Aria turns one job request into booked interviews: it parses the brief, sources matched talent, drafts outreach for your approval, and books the room. Human approval, machine speed.",
  },
  {
    icon: <Building2 className="h-6 w-6" />,
    title: "The Operations Floor",
    body:
      "Watch your whole fleet at work: a live 2D grid or a 3D office you can orbit. Each agent is a real, authorized sending identity, coordinated so no candidate is ever double-contacted.",
  },
  {
    icon: <Bot className="h-6 w-6" />,
    title: "Fleet · Chat · Memory · Soul",
    body:
      "Deploy and tune up to 300 agents. Chat with any agent live, give each a persona (Soul) and long-term Memory, and assign per-agent models and tools from the Fleet.",
  },
  {
    icon: <SlidersHorizontal className="h-6 w-6" />,
    title: "Connect & go live, safely",
    body:
      "In Settings, connect your LLM providers and integrations right in the UI. No code, no .env. Everything stays dry-run until you flip Live mode: nothing real ever leaves without your approval.",
  },
];

/**
 * First-run guided tour. Shows once per browser (localStorage flag) and can be
 * skipped at any step. Mounted in the app shell so it appears on first load of
 * any page. Persistence is client-only, so it never touches the workspace state.
 */
export function Onboarding() {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {
      /* private mode — skip the tour silently */
    }
  }, []);

  const finish = React.useCallback(() => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, []);

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Modal
      open={open}
      onClose={finish}
      title={s.title}
      description={`Step ${step + 1} of ${STEPS.length}`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="subtle" size="sm" onClick={finish}>
            Skip tour
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
              <Button variant="primary" size="sm" onClick={finish}>
                Get started
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
          {s.icon}
        </div>
        <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
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
