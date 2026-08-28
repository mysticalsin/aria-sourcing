"use client";

import * as React from "react";
import {
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Eyebrow,
  Badge,
  Button,
  EmptyState,
  Modal,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { BookingCalendar } from "@/components/calendar/booking-calendar";
import { InterviewerPanel } from "@/components/calendar/interviewer-panel";
import { useHydrated, useBookings, useCandidates, useActions } from "@/lib/store";
import { bookingCalendarSummary, bookingInterviewTitle, bookingNeedsCalendar } from "@/lib/booking-status";
import type { Booking, Candidate } from "@/lib/types";
import {
  cn,
  initialsFrom,
  scoreTone,
  formatDateTime,
  copyToClipboard,
  pluralize,
} from "@/lib/utils";
import {
  CalendarDays,
  CalendarPlus,
  CalendarCheck2,
  Video,
  MapPin,
  Mail,
  Copy,
  UserRound,
  Sparkles,
} from "lucide-react";

type BookingPreview = {
  booking: Booking;
  prepEmail: string;
  confirmationEmail: string;
  prepQueued?: boolean;
};

function EmailBlock({
  icon,
  title,
  subtitle,
  body,
  onCopy,
  previewOnly = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  body: string;
  onCopy: () => void;
  previewOnly?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="grid h-7 w-7 place-items-center rounded-lg bg-aqua-soft text-aqua"
            aria-hidden
          >
            {icon}
          </span>
          <div>
            <p className="text-sm font-bold text-ink">{title}</p>
            <p className="text-xs text-muted">{subtitle}</p>
          </div>
        </div>
        {previewOnly ? (
          <Badge tone="warning" size="sm">
            Preview only
          </Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden />}
            onClick={onCopy}
          >
            Copy
          </Button>
        )}
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-4 font-sans text-sm leading-relaxed text-ink-soft">
        {body}
      </pre>
    </div>
  );
}

function ReadyToBookPanel({ candidates }: { candidates: Candidate[] }) {
  const a = useActions();
  const { toast } = useToast();
  const [preview, setPreview] = React.useState<BookingPreview | null>(null);
  const [booking, setBooking] = React.useState<string | null>(null);

  async function handleBook(candidate: Candidate) {
    setBooking(candidate.id);
    const res = await a.createBookingFor(candidate.id, {
      startTime:
        candidate.interviewProposal?.startTime
        || candidate.preCallProposal?.startTime
        || undefined,
    });
    setBooking(null);
    if (!res.ok) {
      toast({
        title: "Couldn't book interview",
        description: res.error,
        variant: "error",
      });
      return;
    }
    setPreview({
      booking: res.booking,
      prepEmail: res.prepEmail,
      confirmationEmail: res.confirmationEmail,
      prepQueued: res.prepQueued,
    });
    const prepQueued = res.ok && res.prepQueued === true;
    toast({
      title: bookingInterviewTitle(res.booking, candidate.name),
      description: prepQueued
        ? "Interview prep drafts queued in Outreach — approve before anything sends."
        : !bookingNeedsCalendar(res.booking)
          ? "Teams/Outlook event created and added to the schedule."
          : res.booking.calendarSync
            ? "Calendar event saved without a meeting link. Re-book with confirmLive after OnlineMeetings scope."
            : "Slot saved locally. Connect Microsoft Graph and use confirmLive to issue a Teams link — not a live booked interview.",
      variant: bookingNeedsCalendar(res.booking) ? "warning" : "success",
    });
  }

  async function copy(text: string, label: string) {
    const ok = await copyToClipboard(text);
    toast({
      title: ok ? `${label} copied` : "Couldn't copy",
      variant: ok ? "success" : "error",
    });
  }

  return (
    <>
      <Card>
        <CardHeader className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>Interested · awaiting booking</Eyebrow>
            <CardTitle className="mt-1">Ready to book</CardTitle>
          </div>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-2xl bg-tangerine-soft text-tangerine"
            aria-hidden
          >
            <CalendarPlus className="h-4 w-4" />
          </span>
        </CardHeader>
        <CardBody>
          {candidates.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck2 className="h-6 w-6" aria-hidden />}
              title="All caught up"
              description="No interested candidates are waiting on a slot. Interested replies move candidates into this lane automatically."
            />
          ) : (
            <ul className="space-y-2.5">
              {candidates.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3.5 sm:flex-row sm:items-center"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-xs font-bold text-ink-soft ring-1 ring-inset ring-ink/10"
                    aria-hidden
                  >
                    {c.avatarInitials || initialsFrom(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold text-ink">{c.name}</span>
                      <Badge tone={scoreTone(c.matchScore)} size="sm" dot>
                        {c.matchScore}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted">
                      {c.currentTitle} @ {c.currentCompany}
                    </p>
                    {c.interviewProposal?.startTime || c.preCallProposal?.startTime ? (
                      <p className="mt-0.5 text-[0.6875rem] font-medium text-tangerine">
                        {c.preCallProposal?.startTime && !c.interviewProposal?.startTime
                          ? "Pre-call proposed "
                          : "Proposed "}
                        {formatDateTime(
                          (c.interviewProposal?.startTime || c.preCallProposal?.startTime) as string,
                        )}
                        {(c.interviewProposal?.proposeStatus || c.preCallProposal?.proposeStatus)
                          ? ` · ${c.interviewProposal?.proposeStatus || c.preCallProposal?.proposeStatus}`
                          : ""}
                      </p>
                    ) : (
                      <p className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-muted">
                        <MapPin className="h-3 w-3" aria-hidden />
                        {c.location} · {c.timezone}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<CalendarPlus className="h-3.5 w-3.5" aria-hidden />}
                    loading={booking === c.id}
                    onClick={() => handleBook(c)}
                    className="shrink-0"
                  >
                    {c.interviewProposal?.startTime || c.preCallProposal?.startTime ? "Confirm slot" : "Book"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={
          preview
            ? bookingInterviewTitle(preview.booking, preview.booking.candidateName)
            : "Interview booking"
        }
        description={
          preview && preview.prepQueued
            ? "Prep and confirmation drafts are queued in Outreach — approve before send. Copy is preview-only."
            : preview && !bookingNeedsCalendar(preview.booking)
              ? preview.prepQueued === false
                ? "Live calendar event created, but prep drafts failed to queue — review emails below and draft manually in Outreach. Copy is preview-only."
                : "Live calendar event created. Prep and confirmation go through Outreach — copy is preview-only."
              : "Needs calendar — no Teams/Outlook event was created. Connect a live Graph seat and use Confirm slot / confirmLive. Prep emails below are preview-only; this is not a booked interview."
        }
        footer={
          <Button variant="primary" size="sm" onClick={() => setPreview(null)}>
            Done
          </Button>
        }
      >
        {preview && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <UserRound className="h-4 w-4 text-ink-soft" aria-hidden />
                  {preview.booking.interviewer}
                </p>
                <Badge
                  tone={bookingNeedsCalendar(preview.booking) ? "warning" : "success"}
                  size="sm"
                  dot
                >
                  {bookingNeedsCalendar(preview.booking)
                    ? "Needs calendar"
                    : preview.booking.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{preview.booking.role}</p>
              <p className="mt-1 text-xs text-muted">
                {formatDateTime(preview.booking.startTime)} · {preview.booking.timezone}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {preview.booking.teamsLink || preview.booking.calLink ? (
                  <>
                    {preview.booking.teamsLink && (
                      <a
                        href={preview.booking.teamsLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-electric-soft px-3 text-xs font-semibold text-electric ring-1 ring-inset ring-electric/20 transition hover:bg-electric/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                      >
                        <Video className="h-3.5 w-3.5" aria-hidden />
                        Join Teams
                      </a>
                    )}
                    {preview.booking.calLink && (
                      <a
                        href={preview.booking.calLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-soft px-3 text-xs font-semibold text-violet ring-1 ring-inset ring-violet/20 transition hover:bg-violet/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                        Open calendar
                      </a>
                    )}
                  </>
                ) : preview.booking.calendarSync ? (
                  <p className="text-xs text-muted">
                    {bookingCalendarSummary(preview.booking)}
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    Needs calendar — connect Microsoft Graph and book with confirmLive to create
                    an online meeting. This is not a live Teams interview yet.
                  </p>
                )}
              </div>
            </div>

            {preview.prepQueued ? (
              <div className="rounded-2xl border border-tangerine/30 bg-tangerine-soft px-4 py-3 text-sm text-ink-soft">
                <p className="font-semibold text-ink">Queued in Outreach</p>
                <p className="mt-1 text-xs">
                  Interview prep drafts were enqueued for human approval — do not copy/paste send from here.
                </p>
              </div>
            ) : !bookingNeedsCalendar(preview.booking) ? (
              <div className="rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink-soft">
                <p className="font-semibold text-ink">Prep not queued</p>
                <p className="mt-1 text-xs">
                  Live calendar event exists but Outreach prep drafts did not enqueue — draft and approve in
                  Outreach; do not copy/paste send from here.
                </p>
              </div>
            ) : null}

            <EmailBlock
              icon={<UserRound className="h-3.5 w-3.5" aria-hidden />}
              title="Interviewer prep"
              subtitle={`To ${preview.booking.interviewer}`}
              body={preview.prepEmail}
              previewOnly={preview.prepQueued || !bookingNeedsCalendar(preview.booking)}
              onCopy={() => copy(preview.prepEmail, "Prep email")}
            />
            <EmailBlock
              icon={<Mail className="h-3.5 w-3.5" aria-hidden />}
              title="Candidate confirmation"
              subtitle={`To ${preview.booking.candidateName}`}
              body={preview.confirmationEmail}
              previewOnly={preview.prepQueued || !bookingNeedsCalendar(preview.booking)}
              onCopy={() => copy(preview.confirmationEmail, "Confirmation email")}
            />
          </div>
        )}
      </Modal>
    </>
  );
}

export default function CalendarPage() {
  const hydrated = useHydrated();
  const bookings = useBookings();
  const candidates = useCandidates();

  const ready = candidates.filter(
    (c) =>
      c.stage === "Interested" &&
      (!c.booking || bookingNeedsCalendar(c.booking)) &&
      !c.complianceFlags.suppressed &&
      !c.complianceFlags.doNotContact,
  );
  const bookedInterviews = bookings.filter((b) => !bookingNeedsCalendar(b));
  const needsCalendarCount = bookings.filter((b) => bookingNeedsCalendar(b)).length;

  return (
    <>
      <PageHeader
        eyebrow="Scheduling"
        title="Interview calendar"
        description="Confirmed interviews and loop-proposed slots for interested candidates. Without a live Graph seat, rows stay Needs calendar — never treat local slots as booked Teams interviews."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet" dot>
              {pluralize(bookedInterviews.length, "interview")}
            </Badge>
            <Badge tone="tangerine" dot>
              {ready.length} ready
            </Badge>
            {needsCalendarCount > 0 ? (
              <Badge tone="warning" dot>
                {needsCalendarCount} needs calendar
              </Badge>
            ) : null}
          </div>
        }
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <EmptyState
            title="Loading calendar…"
            description="Workspace state is still hydrating. Confirmed Teams interviews appear here once ready — no placeholder agenda."
          />
        }
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Agenda */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex items-start justify-between gap-3">
                <div>
                  <Eyebrow>Agenda</Eyebrow>
                  <CardTitle className="mt-1">Scheduled interviews</CardTitle>
                </div>
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-soft text-violet"
                  aria-hidden
                >
                  <CalendarDays className="h-4 w-4" />
                </span>
              </CardHeader>
              <CardBody>
                <BookingCalendar bookings={bookings} />
              </CardBody>
            </Card>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <ReadyToBookPanel candidates={ready} />
            <InterviewerPanel />
            <p className="flex items-start gap-1.5 px-1 text-xs text-muted">
              <Sparkles className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-tangerine")} aria-hidden />
              Booking with confirmLive creates a real Outlook/Teams event only when a live Graph
              seat is connected. Local slots without sync show Needs calendar — never treat them as
              booked interviews. Outreach still needs approve/send.
            </p>
          </div>
        </div>
      </HydrationGate>
    </>
  );
}
