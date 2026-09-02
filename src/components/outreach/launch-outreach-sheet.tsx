"use client";

import * as React from "react";
import { Badge, Button, Drawer, Field, Input, Select, useToast } from "@/components/ui";
import { useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { LINKEDIN_ASSISTED_PROVIDER, LINKEDIN_VENDOR_PROVIDER } from "@/lib/linkedin-channel";
import { LOOP_DEFAULT_DAILY_CAP, LOOP_DEFAULT_QUIET_HOURS } from "@/lib/linkedin-loop";
import { LINKEDIN_SENDING_OFF, type LinkedInSendingControls } from "@/lib/linkedin-caps";
import {
  LAUNCH_COPY,
  draftLaunchState,
  shortlistForLaunch,
  type DraftLaunchState,
  type LaunchApprovalRow,
  type LaunchDraft,
  type LaunchPerson,
} from "@/lib/linkedin-campaign";
import type { AgentSeat, Campaign, Candidate, OutreachMessage } from "@/lib/types";
import { Linkedin } from "lucide-react";

type CampaignGrant = {
  id: string;
  scope: "replies" | "campaign";
  campaign_id: string;
  calendar_seat_id: string | null;
  daily_cap: number;
  quiet_start: number;
  quiet_end: number;
  timezone: string;
  granted_at: string;
  revoked_at: string | null;
  drafts: LaunchApprovalRow[];
};

const STATE_TONE: Record<DraftLaunchState, "success" | "warning" | "neutral"> = {
  launched: "success",
  changed: "warning",
  "not-launched": "neutral",
};

const STATE_LABEL: Record<DraftLaunchState, string> = {
  launched: LAUNCH_COPY.launched,
  changed: LAUNCH_COPY.changed,
  "not-launched": LAUNCH_COPY.notLaunched,
};

function clampHour(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : fallback;
}

/** The newest LinkedIn first-touch draft still waiting for a person, per candidate. */
export function latestLinkedInDraft(outreach: OutreachMessage[], candidateId: string): OutreachMessage | null {
  return (
    outreach
      .filter(
        (m) =>
          m.candidateId === candidateId &&
          m.channel === "LinkedIn" &&
          m.status !== "Rejected" &&
          m.status !== "Scheduled" &&
          m.body.trim() !== "",
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
  );
}

/**
 * Launch outreach: the sheet behind the one human tap for a campaign
 * (docs/outreach/ARIA-LINKEDIN-CONNECT.md 2.3). It shows the people, the first
 * message each will receive, the daily limits, quiet hours and the calendar.
 * The tap approves exactly what is on screen. People added later show as
 * "Not launched yet" with "Add to launch"; an edited message shows as
 * "Changed since launch" until it is added again.
 */
export function LaunchOutreachSheet({
  open,
  onClose,
  campaign,
  candidates,
  outreach,
  seats,
}: {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  candidates: Candidate[];
  outreach: OutreachMessage[];
  seats: AgentSeat[];
}) {
  const role = useRole();
  const { toast } = useToast();
  const canLaunch = can(role, "outreach");
  const [controls, setControls] = React.useState<LinkedInSendingControls>(LINKEDIN_SENDING_OFF);
  const [grant, setGrant] = React.useState<CampaignGrant | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [quietStart, setQuietStart] = React.useState(String(LOOP_DEFAULT_QUIET_HOURS.start));
  const [quietEnd, setQuietEnd] = React.useState(String(LOOP_DEFAULT_QUIET_HOURS.end));
  const [calendarSeatId, setCalendarSeatId] = React.useState("");
  const quietStartId = React.useId();
  const quietEndId = React.useId();
  const calendarId = React.useId();

  const linkedinSeat =
    seats.find((s) => s.status === "active" && s.mode === "live" && s.provider === LINKEDIN_VENDOR_PROVIDER) ??
    seats.find((s) => s.status === "active" && (s.provider === LINKEDIN_VENDOR_PROVIDER || s.provider === LINKEDIN_ASSISTED_PROVIDER)) ??
    null;
  const calendarSeats = seats.filter((s) => s.status === "active" && (s.provider === "Gmail API" || s.provider === "Microsoft Graph"));

  const load = React.useCallback(async () => {
    try {
      const [controlsRes, grantsRes] = await Promise.all([
        fetch("/api/outreach/linkedin-loop/controls"),
        fetch(`/api/outreach/linkedin-loop/launch?campaignId=${encodeURIComponent(campaign.id)}`),
      ]);
      const controlsJson = (await controlsRes.json().catch(() => null)) as Partial<LinkedInSendingControls> | null;
      if (controlsRes.ok && controlsJson) {
        setControls({
          ...LINKEDIN_SENDING_OFF,
          killSwitch: controlsJson.killSwitch !== false,
          enabled: controlsJson.enabled === true,
          persisted: controlsJson.persisted === true,
          messageCap: typeof controlsJson.messageCap === "number" ? controlsJson.messageCap : 0,
          connectCap: typeof controlsJson.connectCap === "number" ? controlsJson.connectCap : 0,
          timezone: typeof controlsJson.timezone === "string" && controlsJson.timezone ? controlsJson.timezone : "UTC",
          messagesToday: typeof controlsJson.messagesToday === "number" ? controlsJson.messagesToday : 0,
          connectsToday: typeof controlsJson.connectsToday === "number" ? controlsJson.connectsToday : 0,
        });
      }
      const grantsJson = (await grantsRes.json().catch(() => null)) as { grants?: CampaignGrant[] } | null;
      const live =
        grantsRes.ok && Array.isArray(grantsJson?.grants)
          ? (grantsJson.grants.find((g) => g.campaign_id === campaign.id && !g.revoked_at) ?? null)
          : null;
      setGrant(live);
      if (live) {
        setQuietStart(String(live.quiet_start));
        setQuietEnd(String(live.quiet_end));
        setCalendarSeatId(live.calendar_seat_id ?? "");
      }
    } catch {
      setControls(LINKEDIN_SENDING_OFF);
      setGrant(null);
    } finally {
      setLoaded(true);
    }
  }, [campaign.id]);

  React.useEffect(() => {
    if (!open) return;
    setLoaded(false);
    void load();
  }, [open, load]);

  const people: LaunchPerson[] = shortlistForLaunch(candidates);
  const approvals = grant?.scope === "campaign" ? grant.drafts : [];
  const rows = people.map((person) => {
    const message = latestLinkedInDraft(outreach, person.candidateId);
    const draft: LaunchDraft | null = message
      ? { messageId: message.id, candidateId: person.candidateId, profileUrl: person.profileUrl, subject: message.subject, body: message.body }
      : null;
    const state: DraftLaunchState | null = draft ? draftLaunchState(draft, approvals) : null;
    return { person, draft, state };
  });
  const pending = rows.filter((r) => r.draft && r.state !== "launched").map((r) => r.draft as LaunchDraft);
  const launchedCount = rows.filter((r) => r.state === "launched").length;
  const campaignLaunched = grant?.scope === "campaign";
  const blockedByReplyGrant = grant !== null && grant.scope !== "campaign";

  async function launch() {
    if (!linkedinSeat || pending.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/outreach/linkedin-loop/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "campaign",
          campaignId: campaign.id,
          seatId: linkedinSeat.id,
          calendarSeatId: calendarSeatId || undefined,
          interviewerEmail: campaign.hiringManagerEmail || "",
          roleTitle: campaign.title.slice(0, 160),
          dailyCap: LOOP_DEFAULT_DAILY_CAP,
          quietStart: clampHour(quietStart, LOOP_DEFAULT_QUIET_HOURS.start),
          quietEnd: clampHour(quietEnd, LOOP_DEFAULT_QUIET_HOURS.end),
          timezone: controls.timezone,
          drafts: pending,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; persisted?: boolean; approved?: number; added?: boolean }
        | null;
      if (!res.ok || json?.ok !== true) {
        const reason = json?.error ?? "The server refused the launch.";
        toast({
          title: campaignLaunched ? "Nothing added" : "Not launched",
          description:
            reason === "already-launched"
              ? "This campaign already has a reply launch. Revoke it in Settings, LinkedIn sending, then launch again."
              : reason === "seat-not-linkedin"
                ? LAUNCH_COPY.noSeat
                : reason,
          variant: "error",
        });
        return;
      }
      if (json.persisted === false) {
        toast({ title: "Demo: nothing launched", description: "No launch is recorded without a backend.", variant: "info" });
        return;
      }
      const approved = typeof json.approved === "number" ? json.approved : pending.length;
      toast({
        title: json.added ? `${approved} added to the launch` : `Outreach launched for ${approved} ${approved === 1 ? "person" : "people"}`,
        description: "Messages go out from your LinkedIn account two to ten minutes apart, inside the daily limits.",
        variant: "success",
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const launchDisabled =
    !canLaunch || busy || !loaded || !linkedinSeat || pending.length === 0 || blockedByReplyGrant;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={LAUNCH_COPY.title}
      description={LAUNCH_COPY.description}
      width="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted" data-testid="launch-outreach-summary">
            {campaignLaunched
              ? `${launchedCount} launched, ${pending.length} waiting for a tap.`
              : `${pending.length} ${pending.length === 1 ? "person" : "people"} will be messaged.`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button
              variant="primary"
              leftIcon={<Linkedin className="h-4 w-4" />}
              onClick={() => void launch()}
              loading={busy}
              disabled={launchDisabled}
              data-testid="launch-outreach-button"
            >
              {campaignLaunched ? LAUNCH_COPY.addToLaunch : LAUNCH_COPY.launch}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {!linkedinSeat && (
          <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-ink">
            {LAUNCH_COPY.noSeat}
          </p>
        )}
        {blockedByReplyGrant && (
          <p role="alert" className="rounded-2xl border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-ink">
            This campaign already has a reply launch. Revoke it in Settings, LinkedIn sending, then launch outreach from here.
          </p>
        )}

        <div className="grid gap-3 rounded-2xl bg-ink/[0.03] p-4 sm:grid-cols-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Messages per day</div>
            <div className="text-sm text-ink" data-testid="launch-message-cap">
              {controls.messagesToday} of {controls.messageCap} used today
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Connection requests per day</div>
            <div className="text-sm text-ink" data-testid="launch-connect-cap">
              {controls.connectsToday} of {controls.connectCap} used today
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Timezone</div>
            <div className="text-sm text-ink">{controls.timezone}</div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Quiet from" htmlFor={quietStartId} hint="Local hour, 0 to 23.">
            <Input
              id={quietStartId}
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              step={1}
              value={quietStart}
              disabled={busy || campaignLaunched}
              onChange={(e) => setQuietStart(e.target.value)}
              onBlur={() => setQuietStart(String(clampHour(quietStart, LOOP_DEFAULT_QUIET_HOURS.start)))}
            />
          </Field>
          <Field label="Quiet until" htmlFor={quietEndId} hint="Nothing sends inside quiet hours.">
            <Input
              id={quietEndId}
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              step={1}
              value={quietEnd}
              disabled={busy || campaignLaunched}
              onChange={(e) => setQuietEnd(e.target.value)}
              onBlur={() => setQuietEnd(String(clampHour(quietEnd, LOOP_DEFAULT_QUIET_HOURS.end)))}
            />
          </Field>
          <Field label="Interviews go on" htmlFor={calendarId} hint="The calendar that holds booked meetings.">
            <Select
              id={calendarId}
              value={calendarSeatId}
              disabled={busy || campaignLaunched}
              onChange={(e) => setCalendarSeatId(e.target.value)}
              options={[
                { value: "", label: calendarSeats.length ? "Choose a calendar" : "No calendar connected" },
                ...calendarSeats.map((s) => ({ value: s.id, label: s.operatorEmail || s.name })),
              ]}
            />
          </Field>
        </div>

        {people.length === 0 ? (
          <p className="text-sm text-muted">{LAUNCH_COPY.nobody}</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line" data-testid="launch-people">
            {rows.map(({ person, draft, state }) => (
              <li key={person.candidateId} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{person.name}</div>
                    <div className="truncate text-xs text-muted">
                      {person.headline || person.profileUrl} · score {person.matchScore}
                    </div>
                  </div>
                  <Badge tone={state ? STATE_TONE[state] : "neutral"} size="sm" dot>
                    {state ? STATE_LABEL[state] : LAUNCH_COPY.noDraft}
                  </Badge>
                </div>
                {draft ? (
                  <div className="rounded-xl bg-ink/[0.03] px-3 py-2">
                    <div className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">First message</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{draft.body}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted">Generate a message from the candidate first. Nothing is sent to anyone without a draft you have seen.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
