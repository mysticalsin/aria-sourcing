"use client";

import * as React from "react";
import { Modal, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Inbox,
  Monitor,
  Hand,
  ShieldCheck,
  Send,
  ArrowLeft,
} from "lucide-react";

const KEY = "hermes:onboarded:v2";

type Step = { icon: React.ReactNode; title: string; body: string };

const STEPS: Step[] = [
  {
    icon: <Sparkles className="h-6 w-6" />,
    title: "Welcome to Aria Sourcing",
    body:
      "Autonomous recruiting by Mantu. Aria turns one job request into booked interviews: parse the brief, source matched talent, draft outreach for your approval, then send via an isolated LinkedIn Browser Computer — human approval, machine speed.",
  },
  {
    icon: <Inbox className="h-6 w-6" />,
    title: "Connect email & pick an LLM",
    body:
      "In Settings, connect Gmail or Outlook and choose the recruitment model. Dry-run stays on until you flip it under Approval & Compliance — nothing contacts candidates until then.",
  },
  {
    icon: <Monitor className="h-6 w-6" />,
    title: "Create a campaign & attach an agent",
    body:
      "Pull a need from Intake, create the campaign, then attach a LinkedIn Browser Computer seat on the Agents tab. One seat = one Chromium profile — never share research browsers for send.",
  },
  {
    icon: <Hand className="h-6 w-6" />,
    title: "Take control · log into LinkedIn",
    body:
      "Start the agent, Take control, complete LinkedIn login and 2FA in the live view, then Release. While you hold control the bot refuses sends. If the session needs help, Aria surfaces help_requested.",
  },
  {
    icon: <ShieldCheck className="h-6 w-6" />,
    title: "Approve outreach",
    body:
      "Review drafts on Outreach. Approve only what you want sent. With dry-run on, approval is a rehearsal; turn dry-run off when you are ready for live contact.",
  },
  {
    icon: <Send className="h-6 w-6" />,
    title: "Send — paced & honest",
    body:
      "Send approved LinkedIn messages. Aria enforces human-like gaps, daily caps, business hours, and session health — and never pretends a blocked send was a success.",
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
