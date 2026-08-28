"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Badge, Card, CardContent, Button } from "@/components/ui";
import {
  useDefaultModels,
  useLlmProviders,
  useSavedModels,
  useSeats,
  useSettings,
} from "@/lib/store";
import { seatHasOutlookMailbox } from "@/lib/outlook-needs";
import { supabaseEnabled } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";
import { Check, Circle, Cpu, Inbox, Power, Rocket } from "lucide-react";

function seatHasOauthMailbox(seat: { provider?: string; connectedAccount?: string }): boolean {
  if (seatHasOutlookMailbox(seat)) return true;
  return seat.provider === "Gmail API" && Boolean(seat.connectedAccount?.trim());
}

type Step = {
  id: string;
  title: string;
  body: string;
  done: boolean;
  ctaLabel: string;
  href: string;
  icon: React.ReactNode;
};

export function SetupGuidePanel({ onGoAi }: { onGoAi?: () => void }) {
  const seats = useSeats();
  const settings = useSettings();
  const providers = useLlmProviders();
  const models = useSavedModels();
  const defaults = useDefaultModels();

  const outlookOk = seats.some(seatHasOauthMailbox);
  const sourcingModel = defaults.sourcing
    ? models.find((m) => m.id === defaults.sourcing)
    : undefined;
  const sourcingProvider = sourcingModel
    ? providers.find((p) => p.id === sourcingModel.providerId)
    : undefined;
  const llmOk = Boolean(
    sourcingModel?.enabled && sourcingProvider?.enabled && sourcingProvider.kind !== "Kimi",
  );

  const steps: Step[] = [
    {
      id: "outlook",
      title: "Connect email",
      body: supabaseEnabled
        ? "Link Outlook (or Gmail) in Settings → Integrations. Hiring needs arrive via Microsoft Graph webhook push — no inbox polling."
        : "Turn on live Supabase, then connect Outlook under Settings → Integrations for Graph webhook intake.",
      done: outlookOk,
      ctaLabel: outlookOk ? "Manage mailboxes" : "Connect email",
      href: "/settings?tab=integrations",
      icon: <Inbox className="h-4 w-4" aria-hidden />,
    },
    {
      id: "llm",
      title: "Pick the recruitment LLM",
      body: "Choose which model sources candidates, parses needs, and drafts outreach.",
      done: llmOk,
      ctaLabel: llmOk ? "Change models" : "Pick models",
      href: "/settings?tab=ai",
      icon: <Cpu className="h-4 w-4" aria-hidden />,
    },
    {
      id: "loop",
      title: "Arm the sourcing loop",
      body: "Settings → Observability → Arm enterprise loop (workspace switchboard). Fly also needs ARIA_LOOP_KILL_SWITCH=false on the loop process.",
      done: false,
      ctaLabel: "Open switchboard",
      href: "/settings?tab=observe",
      icon: <Power className="h-4 w-4" aria-hidden />,
    },
    {
      id: "source",
      title: "Webhook needs & source",
      body: "On Intake, wait for Graph-delivered needs (or paste a brief). Emergency sync is break-glass only when ARIA_ALLOW_INBOX_SYNC=1. Then create the campaign and source.",
      done: false,
      ctaLabel: "Go to Intake",
      href: "/intake",
      icon: <Rocket className="h-4 w-4" aria-hidden />,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="overflow-hidden border-tangerine/20 bg-gradient-to-br from-surface via-surface to-tangerine/[0.06]">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Plug and play — four steps</p>
            <p className="mt-1 text-xs text-muted">
              Stupid-simple path from empty workspace to live sourcing. Dry-run stays{" "}
              {settings.dryRunMode ? "on" : "off"} until you flip it under Approval & Compliance.
            </p>
          </div>
          <Badge tone={doneCount >= 2 ? "success" : "electric"} size="sm">
            {doneCount}/2 foundations ready
          </Badge>
        </div>

        <ol className="space-y-3">
          {steps.map((step, i) => (
            <motion.li
              key={step.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, type: "spring", stiffness: 360, damping: 28 }}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between",
                step.done ? "border-success/30 bg-success/[0.06]" : "border-line bg-surface",
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    step.done ? "bg-success text-white" : "bg-ink/[0.06] text-ink-soft",
                  )}
                  aria-hidden
                >
                  {step.done ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="text-muted">{String(i + 1).padStart(2, "0")}</span>
                    {step.icon}
                    {step.title}
                  </p>
                  <p className="mt-1 text-xs text-muted">{step.body}</p>
                </div>
              </div>
              {step.id === "llm" && onGoAi ? (
                <Button type="button" size="sm" variant={step.done ? "outline" : "primary"} onClick={onGoAi}>
                  {step.ctaLabel}
                </Button>
              ) : (
                <Link
                  href={step.href}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-semibold",
                    step.done
                      ? "border border-ink/15 bg-surface text-ink hover:bg-canvas"
                      : "bg-ink text-paper hover:bg-ink/90",
                  )}
                >
                  {step.ctaLabel}
                </Link>
              )}
            </motion.li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
