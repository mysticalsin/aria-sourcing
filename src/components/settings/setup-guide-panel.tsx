"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Badge, Card, CardContent, Button } from "@/components/ui";
import {
  useCampaigns,
  useDefaultModels,
  useLlmProviders,
  useSavedModels,
  useSeats,
  useSettings,
} from "@/lib/store";
import { seatHasOutlookMailbox } from "@/lib/outlook-needs";
import { supabaseEnabled } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";
import { LINKEDIN_OUTREACH_STACK_ID } from "@/components/settings/linkedin-outreach-stack";
import {
  Check,
  Circle,
  Cpu,
  Hand,
  Inbox,
  Monitor,
  Rocket,
  Send,
  ShieldCheck,
} from "lucide-react";

function seatHasOauthMailbox(seat: { provider?: string; connectedAccount?: string }): boolean {
  if (seatHasOutlookMailbox(seat)) return true;
  return seat.provider === "Gmail API" && Boolean(seat.connectedAccount?.trim());
}

function isBrowserComputerSeat(seat: {
  provider?: string;
  linkedinDeliveryBackend?: string | null;
  computerId?: string | null;
}): boolean {
  return (
    seat.provider === "LinkedIn Browser Computer" ||
    seat.linkedinDeliveryBackend === "browser-computer" ||
    Boolean(seat.computerId)
  );
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

/**
 * Plug-and-play path for LinkedIn Browser Computer (AriaBot) happy path.
 * Dry-run stays on until Approval & Compliance flips it — nothing contacts candidates until then.
 */
export function SetupGuidePanel({ onGoAi }: { onGoAi?: () => void }) {
  const seats = useSeats();
  const settings = useSettings();
  const campaigns = useCampaigns();
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
  const campaign = campaigns[0];
  const campaignOk = campaigns.length > 0;
  const browserSeats = seats.filter(isBrowserComputerSeat);
  const attachedOk =
    Boolean(campaign) &&
    browserSeats.some((s) => {
      const assigned = s.assignedCampaignIds ?? [];
      return assigned.length === 0 || assigned.includes(campaign!.id);
    });
  const agentsHref = campaign
    ? `/campaigns/${campaign.id}?tab=agents`
    : "/campaigns";
  const dryRunOff = !settings.dryRunMode;

  const steps: Step[] = [
    {
      id: "email",
      title: "Connect email",
      body: supabaseEnabled
        ? "Link Gmail or Outlook in Settings → Integrations so Aria can pull needs and send from your mailbox."
        : "Turn on live Supabase, then connect Gmail or Outlook under Settings → Integrations.",
      done: outlookOk,
      ctaLabel: outlookOk ? "Manage mailboxes" : "Connect email",
      href: "/settings?tab=integrations",
      icon: <Inbox className="h-4 w-4" aria-hidden />,
    },
    {
      id: "llm",
      title: "Pick LLM",
      body: "Choose which model sources candidates, parses needs, and drafts outreach.",
      done: llmOk,
      ctaLabel: llmOk ? "Change models" : "Pick models",
      href: "/settings?tab=ai",
      icon: <Cpu className="h-4 w-4" aria-hidden />,
    },
    {
      id: "ariabot",
      title: "Connect AriaBot Browser Computer",
      body: "Attach the computer supervisor, then Open LinkedIn login for agents — one VM seat per LinkedIn profile.",
      done: Boolean(settings.computerSupervisorUrl?.trim()) && browserSeats.length > 0,
      ctaLabel: browserSeats.length > 0 ? "Open AriaBot stack" : "Connect AriaBot",
      href: `/settings?tab=integrations#${LINKEDIN_OUTREACH_STACK_ID}`,
      icon: <Monitor className="h-4 w-4" aria-hidden />,
    },
    {
      id: "campaign",
      title: "Create campaign",
      body: "On Intake, pull open needs from Outlook, parse the brief, and create the campaign.",
      done: campaignOk,
      ctaLabel: campaignOk ? "Open campaigns" : "Go to Intake",
      href: campaignOk ? "/campaigns" : "/intake",
      icon: <Rocket className="h-4 w-4" aria-hidden />,
    },
    {
      id: "attach",
      title: "Attach agent",
      body: "Attach a LinkedIn Browser Computer seat on the campaign Agents tab (1 seat = 1 Chromium).",
      done: attachedOk,
      ctaLabel: attachedOk ? "Manage agents" : "Attach agent",
      href: agentsHref,
      icon: <Monitor className="h-4 w-4" aria-hidden />,
    },
        {
      id: "take-control",
      title: "Take control · LinkedIn login",
      body: browserSeats.some((s) => Boolean(s.computerId?.trim()))
        ? "VM bound — finish LinkedIn login + 2FA in the sandbox if the session is still unverified, then Release."
        : "Open LinkedIn login for agents, sign in (and 2FA) inside the AriaBot VM, then Release so the bot can send.",
      done: browserSeats.some((s) => Boolean(s.computerId?.trim())),
      ctaLabel: browserSeats.some((s) => Boolean(s.computerId?.trim()))
        ? "Open AriaBot stack"
        : "Open LinkedIn login",
      href: `/settings?tab=integrations#${LINKEDIN_OUTREACH_STACK_ID}`,
      icon: <Hand className="h-4 w-4" aria-hidden />,
    },
    {
      id: "approve",
      title: "Approve",
      body: settings.dryRunMode
        ? "Dry-run is ON — approvals rehearse only; nothing contacts candidates until you flip it off under Approval & Compliance."
        : "Approve outreach drafts. Dry-run is off — live Send will contact candidates.",
      done: dryRunOff,
      ctaLabel: settings.dryRunMode ? "Open dry-run settings" : "Open outreach",
      href: settings.dryRunMode ? "/settings?tab=compliance" : "/outreach",
      icon: <ShieldCheck className="h-4 w-4" aria-hidden />,
    },
    {
      id: "send",
      title: "Send",
      body: "Send approved LinkedIn messages from Outreach. Human pacing, session health, and go-live checks apply.",
      done: false,
      ctaLabel: "Open outreach",
      href: "/outreach",
      icon: <Send className="h-4 w-4" aria-hidden />,
    },
  ];

  const foundationDone = [outlookOk, llmOk, Boolean(settings.computerSupervisorUrl?.trim()) && browserSeats.length > 0].filter(Boolean).length;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="overflow-hidden border-tangerine/20 bg-gradient-to-br from-surface via-surface to-tangerine/[0.06]">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">LinkedIn AriaBot — setup path</p>
            <p className="mt-1 text-xs text-muted">
              Connect email → Pick LLM → Connect AriaBot Browser Computer → Create campaign → Attach agent → LinkedIn login → Approve →
              Send. Dry-run is currently{" "}
              <span className="font-semibold text-ink-soft">{settings.dryRunMode ? "on" : "off"}</span>
              {settings.dryRunMode
                ? " — flip it under Approval & Compliance when you are ready to contact for real."
                : "."}
            </p>
          </div>
          <Badge tone={foundationDone >= 3 ? "success" : "electric"} size="sm">
            {doneCount}/{steps.length} steps · {foundationDone}/3 foundations
          </Badge>
        </div>

        <ol className="space-y-3">
          {steps.map((step, i) => (
            <motion.li
              key={step.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, type: "spring", stiffness: 360, damping: 28 }}
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
