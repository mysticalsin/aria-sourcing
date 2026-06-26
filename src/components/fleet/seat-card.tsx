"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Button,
  Meter,
  Modal,
  Field,
  Input,
  useToast,
} from "@/components/ui";
import { useActions, useSettings } from "@/lib/store";
import {
  effectiveDailyCap,
  seatRemainingToday,
  warmupStage,
  seatHealthStatus,
  PROVIDER_LIMIT_NOTE,
} from "@/lib/fleet";
import type { AgentSeat, SeatProvider } from "@/lib/types";
import { cn, type Tone } from "@/lib/utils";
import { AgentPromptEditor } from "./agent-prompt-editor";
import {
  Mail,
  MailCheck,
  Pause,
  Play,
  Radio,
  FlaskConical,
  Pencil,
  ChevronDown,
  Clock,
  Flame,
  ShieldCheck,
} from "lucide-react";

const PROVIDER_TONE: Record<SeatProvider, Tone> = {
  "Microsoft Graph": "electric",
  "Gmail API": "tangerine",
  SendGrid: "aqua",
  Resend: "violet",
};

const STATUS_TONE: Record<AgentSeat["status"], Tone> = {
  active: "success",
  paused: "warning",
  disabled: "neutral",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function formatDays(days: number[]): string {
  if (days.length === 0) return "No days";
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 1) {
    return `${DAY_LABELS[sorted[0]]}–${DAY_LABELS[sorted[sorted.length - 1]]}`;
  }
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}

export function SeatCard({ seat }: { seat: AgentSeat }) {
  const actions = useActions();
  const settings = useSettings();
  const { toast } = useToast();

  const [connectOpen, setConnectOpen] = React.useState(false);
  const [accountEmail, setAccountEmail] = React.useState(seat.connectedAccount || seat.operatorEmail);
  const [editorOpen, setEditorOpen] = React.useState(false);

  const cap = effectiveDailyCap(seat);
  const remaining = seatRemainingToday(seat);
  const stage = warmupStage(seat);
  const health = seatHealthStatus(seat, settings.fleet);
  const isLive = seat.mode === "live";
  const isPaused = seat.status === "paused";
  const isDisabled = seat.status === "disabled";

  const accountEmailId = React.useId();

  function handleToggleStatus() {
    const next = isPaused || isDisabled ? "active" : "paused";
    actions.setSeatStatus(seat.id, next);
    toast({
      title: next === "active" ? `${seat.name} resumed` : `${seat.name} paused`,
      description:
        next === "active"
          ? "Agent is back in the rotation, within its guardrails."
          : "Agent will not be assigned any new contacts until resumed.",
      variant: next === "active" ? "success" : "info",
    });
  }

  function handleConnect() {
    const email = accountEmail.trim();
    if (!email || !email.includes("@")) {
      toast({ title: "Enter a valid mailbox", description: "Use the authorized sending address.", variant: "error" });
      return;
    }
    actions.connectSeatAccount(seat.id, email);
    setConnectOpen(false);
    toast({
      title: "Mailbox connected",
      description: `${email} linked via official API (mock). Verify the domain before going live.`,
      variant: "success",
    });
  }

  function handleToggleLive() {
    const result = actions.toggleSeatLive(seat.id);
    toast({
      title: result.ok ? `${seat.name} updated` : "Cannot go live yet",
      description: result.reason,
      variant: result.ok ? (isLive ? "info" : "warning") : "error",
    });
  }

  return (
    <>
      <Card className="flex h-full flex-col animate-fade-in">
        <CardContent className="flex flex-1 flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>{seat.provider}</Eyebrow>
              <h3 className="truncate text-base font-bold text-ink">{seat.name}</h3>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge tone={isLive ? "tangerine" : "aqua"} size="sm" dot>
                {isLive ? "Live" : "Dry-run"}
              </Badge>
              <Badge tone={STATUS_TONE[seat.status]} size="sm">
                {seat.status === "active" ? "Active" : seat.status === "paused" ? "Paused" : "Disabled"}
              </Badge>
            </div>
          </div>

          {/* Connected mailbox */}
          <div className="flex items-center gap-2 rounded-2xl bg-canvas px-3 py-2.5">
            {seat.connectedAccount ? (
              <MailCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Mail className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {seat.connectedAccount || "Not connected"}
              </p>
              <p className="truncate text-xs text-muted">
                {seat.connectedAccount
                  ? seat.domainVerified
                    ? "Domain verified (SPF/DKIM/DMARC)"
                    : "Domain not verified yet"
                  : "Connect an authorized mailbox to send"}
              </p>
            </div>
            <Badge tone={PROVIDER_TONE[seat.provider]} size="sm" className="ml-auto">
              {seat.provider}
            </Badge>
          </div>

          {/* Quota */}
          <Meter label="Sent today" used={seat.sentToday} limit={cap} />
          <p className="-mt-2 text-xs text-muted">
            {remaining} of today&apos;s {cap} remaining{" "}
            {isPaused || isDisabled ? "· paused, not sending" : ""}
          </p>

          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={health.tone} dot title={health.detail}>
              {health.shouldPause ? "Auto-paused" : health.label}
            </Badge>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs font-medium text-ink-soft">
              <Flame className="h-3.5 w-3.5 text-tangerine" aria-hidden />
              {stage.full ? "Fully warmed" : `Warm-up · day ${stage.day} · cap ${stage.cap}`}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs font-medium text-ink-soft">
              <Clock className="h-3.5 w-3.5 text-electric" aria-hidden />
              {formatDays(seat.sendWindow.days)} {formatHour(seat.sendWindow.startHour)}–
              {formatHour(seat.sendWindow.endHour)} {seat.sendWindow.timezone}
            </span>
          </div>

          {health.shouldPause && (
            <p className="rounded-2xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
              {health.detail}
            </p>
          )}

          {/* Provider limit note */}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
            {PROVIDER_LIMIT_NOTE[seat.provider]} Official APIs only — no scraping, no LinkedIn
            automation.
          </p>

          {/* Controls */}
          <div className="mt-auto space-y-2 pt-1">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                leftIcon={isPaused || isDisabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                onClick={handleToggleStatus}
              >
                {isPaused || isDisabled ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="subtle"
                size="sm"
                className="flex-1"
                leftIcon={<Mail className="h-4 w-4" />}
                onClick={() => setConnectOpen(true)}
              >
                {seat.connectedAccount ? "Mailbox" : "Connect"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant={isLive ? "subtle" : "secondary"}
                size="sm"
                className="flex-1"
                leftIcon={isLive ? <FlaskConical className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
                onClick={handleToggleLive}
              >
                {isLive ? "Switch to dry-run" : "Go live"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                leftIcon={<Pencil className="h-4 w-4" />}
                rightIcon={
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", editorOpen && "rotate-180")}
                  />
                }
                aria-expanded={editorOpen}
                onClick={() => setEditorOpen((v) => !v)}
              >
                Edit prompt
              </Button>
            </div>
          </div>

          {editorOpen && <AgentPromptEditor seat={seat} />}
        </CardContent>
      </Card>

      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title={`Connect mailbox — ${seat.name}`}
        description="Official provider API only. No scraping, no synthetic identities."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConnectOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" leftIcon={<MailCheck className="h-4 w-4" />} onClick={handleConnect}>
              Connect mailbox
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Authorized sending mailbox"
            htmlFor={accountEmailId}
            hint="The real mailbox this operator owns and has authorized. Connected via the official API in mock mode — nothing is sent."
          >
            <Input
              id={accountEmailId}
              type="email"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              placeholder="recruiter@yourcompany.com"
            />
          </Field>
          <div className="flex items-start gap-2 rounded-2xl bg-aqua-soft px-3.5 py-3 text-aqua">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="text-xs leading-relaxed">
              {PROVIDER_LIMIT_NOTE[seat.provider]} Sends stay within the account&apos;s published
              limits, warmed gradually, with global de-dupe so no one is contacted twice.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
