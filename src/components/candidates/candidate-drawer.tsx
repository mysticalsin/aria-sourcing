"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Drawer,
  Eyebrow,
  Input,
  Label,
  useToast,
  useConfirm,
} from "@/components/ui";
import { ScoreGauge } from "@/components/charts/score-gauge";
import { FitRadar } from "@/components/charts/fit-radar";
import { ScoreBreakdown } from "@/components/candidates/score-breakdown";
import { ConsentPassport } from "@/components/candidates/consent-passport";
import { bookingCalendarSummary } from "@/lib/booking-status";
import { useActions, useCampaign, useCandidate, useOutreach, useRole, useSettings } from "@/lib/store";
import type { CandidateErasureObligation, CandidateErasureStatus } from "@/lib/store/contracts";
import { experimentalPaidSourcingEnabled, demoLoginEnabled, supabaseEnabled } from "@/lib/supabase/config";
import {
  downloadText,
  formatTimeAgo,
  toneForIntent,
  toneForOutreachStatus,
  toneForStage,
  type Tone,
} from "@/lib/utils";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { isCandidateErasureTombstone } from "@/lib/candidate-privacy";
import { can } from "@/lib/rbac";
import { computeCoverage } from "@/lib/enrichment/merge";
import { ENRICHMENT_PROVIDERS } from "@/lib/enrichment/registry";
import { StarBadge, SourceBadge } from "@/components/tania/badges";
import {
  deriveLeadSource,
  deriveStarRating,
  DEFAULT_STAR_THRESHOLDS,
  prequalSlaHours,
  isCandidate as isTaniaCandidate,
  STAR_RATING_META,
} from "@/lib/tania";
import type {
  Candidate,
  CandidateStage,
  EnrichableField,
  EnrichmentAttempt,
  FieldProvenance,
  InterviewKind,
  InterviewOutcome,
  LeadSource,
  OutreachMessage,
  PrequalOutcome,
  StarRating,
} from "@/lib/types";
import { INTERVIEW_OUTCOMES, LEAD_SOURCES, STAR_RATINGS } from "@/lib/types";
import {
  Ban,
  Bookmark,
  Briefcase,
  Building2,
  CalendarPlus,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock,
  PartyPopper,
  PhoneCall,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Linkedin,
  Loader2,
  Lock,
  Mail,
  MailX,
  Phone,
  MapPin,
  MessageSquare,
  NotebookPen,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserX,
  Zap,
} from "lucide-react";

type CandidateErasureAuthority = {
  obligationId: string;
  provider: string;
  attemptCount: number;
  reference: Record<string, unknown>;
};

type CandidateErasureScope = {
  generation: number;
  open: boolean;
  candidateId: string | null;
  campaignId: string | null;
};

function isCandidateErasureLegalHoldResponse(response: Response, body: unknown): boolean {
  return response.status === 423
    && body !== null
    && typeof body === "object"
    && !Array.isArray(body)
    && (body as Record<string, unknown>).code === "candidate_erasure_blocked_legal_hold";
}

function parseCandidateErasureObligations(value: unknown): CandidateErasureObligation[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const parsed: CandidateErasureObligation[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const obligation = item as Record<string, unknown>;
    if (
      typeof obligation.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(obligation.id)
      || typeof obligation.provider !== "string"
      || typeof obligation.status !== "string"
      || ![
        "pending_provider",
        "manual_required",
        "retryable_failure",
        "completed",
        "blocked_legal_hold",
      ].includes(obligation.status)
      || !Number.isInteger(obligation.attemptCount)
      || Number(obligation.attemptCount) < 0
      || Number(obligation.attemptCount) > 100
    ) return null;
    parsed.push({
      id: obligation.id,
      provider: obligation.provider,
      status: obligation.status as CandidateErasureStatus,
      attemptCount: Number(obligation.attemptCount),
    });
  }
  return parsed;
}

/** The 7 richness fields the drawer's enrichment panel surfaces as coverage
 *  chips (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md, "Wow
 *  UI") — narrower than the full `ENRICHABLE_FIELDS` (which also has
 *  `location`/`company`, already shown elsewhere in this drawer). */
const DRAWER_ENRICHMENT_FIELDS: EnrichableField[] = [
  "email",
  "phone",
  "skills",
  "experience",
  "headline",
  "education",
  "languages",
];

const ENRICHMENT_FIELD_LABELS: Record<EnrichableField, string> = {
  email: "Email",
  phone: "Phone",
  headline: "Headline",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  languages: "Languages",
  location: "Location",
  company: "Company",
};

const ATTEMPT_STATUS_LABEL: Record<EnrichmentAttempt["status"], string> = {
  ok: "Found data",
  no_data: "No match",
  not_configured: "Connect key",
  no_key_field: "Can't identify",
  budget_exceeded: "Budget reached",
  error: "Error",
  deferred: "Time budget — re-run",
};

const ATTEMPT_STATUS_TONE: Record<EnrichmentAttempt["status"], Tone> = {
  ok: "success",
  no_data: "neutral",
  not_configured: "warning",
  no_key_field: "neutral",
  budget_exceeded: "danger",
  error: "danger",
  deferred: "warning",
};

/** Confidence -> dot color for a filled coverage chip. Undefined confidence
 *  (a value present with no recorded score, e.g. legacy/manual data) reads as
 *  neutral rather than fabricating a level of trust that was never measured. */
function confidenceDotTone(confidence: number | undefined): string {
  if (confidence === undefined) return "bg-ink/25";
  if (confidence >= 0.7) return "bg-success";
  if (confidence >= 0.4) return "bg-warning";
  return "bg-danger";
}

function Section({
  title,
  children,
  icon,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-ink/50">{icon}</span>}
        <Eyebrow>{title}</Eyebrow>
      </div>
      {children}
    </section>
  );
}

/** Manual forward-progression stages surfaced post-interview — the funnel stages
 *  before "Booked" advance automatically from outreach/reply activity, so only
 *  the human-decided outcomes need a control here. */
const STAGE_ACTIONS: CandidateStage[] = ["Interviewed", "Offer", "Hired", "Rejected"];

function Chips({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">None recorded.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {items.map((item) => (
        <li key={item}>
          <span className="inline-flex rounded-full bg-ink/[0.05] px-2.5 py-1 text-xs font-medium text-ink-soft">
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** View-only "why this person" fallback — guarantees the chip(s) below are
 *  never blank, even for the rare draft whose stored personalizationEvidence
 *  came back empty (e.g. a live-sourced draft with no recentActivity). Derived
 *  purely from fields already on the candidate; never written back to the
 *  message, and never substitutes for real evidence when it's present — the
 *  personalization-required approval gate in rules.ts still reads the stored
 *  personalizationEvidence unchanged. */
function personalizationFallbackHook(candidate: Candidate): string {
  const topSkill = candidate.techStack[0];
  if (topSkill) return `${topSkill} background fits this role`;
  if (candidate.currentTitle) return `${candidate.currentTitle} experience fits this role`;
  if (candidate.yearsExperience == null) return "Matched against the role requirements";
  return `${candidate.yearsExperience} yrs of relevant experience`;
}

/** "Why this person" — the personalization evidence behind this candidate's
 *  latest outreach draft, matching the same aqua chip styling the outreach
 *  queue uses (see OutreachMessageCard). Falls back to a single derived hook
 *  when the draft's real evidence is empty, so the section is never blank. */
function WhyThisPerson({ candidate, message }: { candidate: Candidate; message: OutreachMessage }) {
  const real = message.personalizationEvidence.filter((e) => e.trim().length > 0);
  const chips = real.length > 0 ? real : [personalizationFallbackHook(candidate)];
  return (
    <Section title="Why this person" icon={<Sparkles className="h-4 w-4" />}>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((ev, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-full bg-aqua-soft px-2.5 py-1 text-xs font-medium text-aqua ring-1 ring-inset ring-aqua/20"
          >
            {ev}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted">
        From the {message.status.toLowerCase()} outreach draft · sequence step {message.sequenceStep}.
      </p>
    </Section>
  );
}

/** TAnIA panel — lead source, Mantu Star Rating, Prequal decision, interview
 *  rounds and #Vivier. All actions are recruiter-initiated ("Human Always Decides"). */
function TaniaPanel({ c }: { c: Candidate }) {
  const actions = useActions();
  const role = useRole();
  const { toast } = useToast();
  const settings = useSettings();
  const thresholds = settings.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;
  const source = deriveLeadSource(c);
  const rating = c.starRating ?? deriveStarRating(c.matchScore, thresholds);
  const isLead = ["Sourced", "Contacted", "Replied"].includes(c.stage);
  const promoted = isTaniaCandidate(c);
  const sla = prequalSlaHours(rating);
  const INTERVIEW_STEPS: InterviewKind[] = ["Intw1", "Intw2", "Intw3", "QM"];

  const setRating = (r: StarRating) => {
    actions.setCandidateRating(c.id, r);
    toast({ title: `Rating set: ${STAR_RATING_META[r].label}`, variant: "success" });
  };
  const setSource = (s: LeadSource) => actions.setCandidateLeadSource(c.id, s);
  const decide = (outcome: PrequalOutcome) => {
    actions.setPrequalOutcome(c.id, outcome);
    toast({
      title: outcome === "advance" ? "Advanced: lead is now a Candidate" : outcome === "reject" ? "Prequal rejected: added to #Vivier" : "Held for review",
      variant: outcome === "reject" ? "warning" : "success",
    });
  };
  const schedule = async (kind: InterviewKind) => {
    // First interview must go through Outlook/Teams booking — never invent Booked + fake reminders.
    if (kind === "Intw1") {
      const res = await actions.createBookingFor(c.id);
      if (res.ok) {
        toast({
          title: "Intw1 booked on Outlook/Teams",
          description: `With ${res.booking.interviewer || "an interviewer to be confirmed"}. ${bookingCalendarSummary(res.booking)}`,
          variant: "success",
        });
      } else {
        toast({
          title: "Could not book Intw1",
          description: res.error,
          variant: "error",
        });
      }
      return;
    }
    actions.addInterview(c.id, kind, "Hiring Manager", null);
    toast({
      title: `${kind} noted`,
      description: "Round recorded locally. Book the calendar slot from Calendar / Book interview when ready.",
      variant: "info",
    });
  };
  const setOutcome = (interviewId: string, kind: InterviewKind, outcome: InterviewOutcome) => {
    actions.updateInterview(c.id, interviewId, { outcome });
    toast({
      title: `${kind} outcome: ${outcome}`,
      variant: outcome === "Reject" || outcome === "No Show" ? "warning" : "success",
    });
  };
  const toggleVivier = () => {
    actions.toggleVivier(c.id);
    toast({ title: c.vivier ? "Removed from #Vivier" : "Added to #Vivier", variant: c.vivier ? "info" : "success" });
  };

  return (
    <Section title="TAnIA: source, rating & prequal" icon={<PhoneCall className="h-4 w-4" />}>
      {/* Source + rating */}
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={source} />
        <StarBadge rating={rating} />
        {c.vivier && (
          <Badge tone="violet" size="sm">
            <Bookmark className="h-3 w-3" aria-hidden /> #Vivier
          </Badge>
        )}
        {c.referredBy && <span className="text-xs text-muted">Referred by {c.referredBy}</span>}
      </div>

      {/* Rating override */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Star rating {sla ? `· ${sla}h prequal SLA` : "· rejection tier"}</p>
        <div className="flex flex-wrap gap-1.5">
          {STAR_RATINGS.map((r) => (
            <Button key={r} variant={rating === r ? "primary" : "outline"} size="sm" onClick={() => setRating(r)}>
              {r === "TopGun" ? "Top Gun" : r}
            </Button>
          ))}
        </div>
      </div>

      {/* Source reclassify */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Lead source</p>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_SOURCES.map((s) => (
            <Button key={s} variant={source === s ? "primary" : "outline"} size="sm" onClick={() => setSource(s)}>
              {s}
            </Button>
          ))}
        </div>
      </div>

      {/* Prequal decision — the LEAD -> CANDIDATE gate */}
      <div className="rounded-2xl border border-line bg-canvas/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Prequal call</p>
          {c.prequal?.outcome && c.prequal.outcome !== "pending" && (
            <Badge tone={c.prequal.outcome === "advance" ? "success" : c.prequal.outcome === "reject" ? "danger" : "warning"} size="sm">
              {c.prequal.outcome}
            </Badge>
          )}
        </div>
        {promoted ? (
          <p className="text-sm text-muted">Prequalified. This lead is now a Candidate in the interview pipeline.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">
              {isLead ? "Prequalify to promote this lead into a Candidate. One-tap decision:" : "This candidate is past the prequal gate."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="primary" size="sm" disabled={!isLead} onClick={() => decide("advance")}>Advance</Button>
              <Button variant="outline" size="sm" disabled={!isLead} onClick={() => decide("hold")}>Hold</Button>
              <Button variant="outline" size="sm" disabled={!isLead} onClick={() => decide("reject")}>Reject</Button>
            </div>
          </>
        )}
      </div>

      {/* Interview rounds */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Interview rounds</p>
        {c.interviews && c.interviews.length > 0 ? (
          <ul className="space-y-1.5">
            {c.interviews.map((iv) => (
              <li key={iv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink/[0.03] px-3 py-2 text-sm">
                <span className="font-semibold text-ink">{iv.kind}</span>
                <span className="text-muted">{iv.interviewer}</span>
                <div className="flex items-center gap-2">
                  <Badge tone={iv.outcome === "Advance" || iv.outcome === "Completed" ? "success" : iv.outcome === "Reject" || iv.outcome === "No Show" ? "danger" : "aqua"} size="sm">
                    {iv.outcome}
                  </Badge>
                  <select
                    aria-label={`Set outcome for ${iv.kind} interview`}
                    value={iv.outcome}
                    onChange={(e) => setOutcome(iv.id, iv.kind, e.target.value as InterviewOutcome)}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                  >
                    {INTERVIEW_OUTCOMES.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {outcome}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No interviews scheduled yet.</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {INTERVIEW_STEPS.map((kind) => (
            <Button key={kind} variant="subtle" size="sm" leftIcon={<CalendarPlus className="h-3.5 w-3.5" />} disabled={!promoted} onClick={() => schedule(kind)}>
              {kind}
            </Button>
          ))}
        </div>
      </div>

      <Button variant="outline" size="sm" leftIcon={<Bookmark className="h-3.5 w-3.5" />} onClick={toggleVivier}>
        {c.vivier ? "Remove from #Vivier" : "Add to #Vivier"}
      </Button>
    </Section>
  );
}

/** Onboarding progress (TAnIA Stages III→IV) — shown once a candidate reaches an
 *  offer. Steps derive from stage; this is the offer→signed→pre-boarding→employee
 *  journey plus the post-fill signal. */
function OnboardingPanel({ c }: { c: Candidate }) {
  const source = deriveLeadSource(c);
  const hired = c.stage === "Hired";
  const steps: { label: string; done: boolean; note?: string }[] = [
    { label: "Offer sent", done: true, note: "HR pre-fills from SMART; TA congratulates." },
    { label: "Offer signed", done: hired, note: "HR collects signed offer; triggers SMART registration." },
    { label: "Pre-boarding", done: hired, note: "Checklist + candidate → employee portal." },
    { label: "SMART registration + need closure", done: hired, note: "Post-fill report: source of hire captured." },
    { label: "OneStart onboarding", done: hired, note: "TA welcomes; T2P tracked by manager + HR." },
    { label: "Referral Champion", done: false, note: "Engage the new hire to drive referrals." },
  ];
  return (
    <Section title="Onboarding" icon={<PartyPopper className="h-4 w-4" />}>
      <div className="rounded-2xl border border-line bg-canvas/60 p-3">
        <p className="mb-2 text-sm text-muted">
          Source of hire: <span className="font-semibold text-ink">{source}</span>
          {" · "}Time-to-Proficiency touchpoints at 1 / 3 / 6 months.
        </p>
        <ul className="space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-2.5">
              {s.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              )}
              <span>
                <span className={s.done ? "text-sm font-semibold text-ink" : "text-sm text-ink-soft"}>{s.label}</span>
                {s.note && <span className="block text-xs text-muted">{s.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

export function CandidateDrawer({
  candidate,
  open,
  onClose,
}: {
  candidate: Candidate | null;
  open: boolean;
  onClose: () => void;
}) {
  const actions = useActions();
  const role = useRole();
  const { toast } = useToast();
  const confirm = useConfirm();
  // Always read the LIVE record so in-drawer mutations (stage, compliance, history)
  // reflect immediately instead of showing the click-time snapshot.
  const liveCandidate = useCandidate(candidate?.id);
  const campaign = useCampaign(candidate?.campaignId);
  const confidentialityMode = Boolean(useSettings().confidentialityMode);
  const [revealed, setRevealed] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [enrichingApollo, setEnrichingApollo] = useState(false);
  const [revealingSeamless, setRevealingSeamless] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [erasureNotice, setErasureNotice] = useState<{
    status: CandidateErasureStatus;
    requestId?: string;
  } | null>(null);
  const [erasureObligations, setErasureObligations] = useState<CandidateErasureObligation[]>([]);
  const [erasureAuthority, setErasureAuthority] = useState<CandidateErasureAuthority | null>(null);
  const [erasureEvidenceSha256, setErasureEvidenceSha256] = useState("");
  const [erasureCaseReference, setErasureCaseReference] = useState("");
  const [erasureActionId, setErasureActionId] = useState<string | null>(null);
  const [erasureQueueError, setErasureQueueError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  // Index into enrichment.attempts marking where the LAST "Enrich" click's
  // results start — null until the first click this session, so the
  // per-provider progress list stays empty (not a wall of prior history)
  // until the recruiter actually runs the waterfall from this drawer.
  const [attemptsBaseline, setAttemptsBaseline] = useState<number | null>(null);
  const rejectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seamlessPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest not-yet-committed edit for each debounced field, so the unmount
  // cleanup below can flush it instead of dropping it — the cleanup closure is
  // fixed at mount time, so it can't read fresh render-scoped state directly.
  const pendingRejection = useRef<{ id: string; value: string } | null>(null);
  const pendingPhone = useRef<{ id: string; value: string } | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const candidateId = candidate?.id ?? null;
  const candidateCampaignId = candidate?.campaignId ?? null;
  const erasureGenerationRef = useRef(0);
  const erasureControllersRef = useRef(new Set<AbortController>());
  const erasureScopeRef = useRef<Omit<CandidateErasureScope, "generation">>({
    open,
    candidateId,
    campaignId: candidateCampaignId,
  });
  erasureScopeRef.current = {
    open,
    candidateId,
    campaignId: candidateCampaignId,
  };

  const captureErasureScope = useCallback((): CandidateErasureScope => ({
    generation: erasureGenerationRef.current,
    ...erasureScopeRef.current,
  }), []);

  const isErasureScopeCurrent = useCallback((scope: CandidateErasureScope): boolean => {
    const currentScope = erasureScopeRef.current;
    return scope.generation === erasureGenerationRef.current
      && currentScope.open
      && currentScope.candidateId === scope.candidateId
      && currentScope.campaignId === scope.campaignId;
  }, []);

  const abortErasureRequests = useCallback(() => {
    for (const controller of erasureControllersRef.current) controller.abort();
    erasureControllersRef.current.clear();
  }, []);

  const invalidateErasureRequests = useCallback(() => {
    erasureGenerationRef.current += 1;
    abortErasureRequests();
  }, [abortErasureRequests]);

  const beginErasureRequest = useCallback(() => {
    const controller = new AbortController();
    erasureControllersRef.current.add(controller);
    return { controller, scope: captureErasureScope() };
  }, [captureErasureScope]);

  const releaseErasureRequest = useCallback((controller: AbortController) => {
    erasureControllersRef.current.delete(controller);
  }, []);

  useEffect(() => {
    invalidateErasureRequests();
    setRevealed(false);
    setNoteText("");
    setErasing(false);
    setErasureNotice(null);
    setErasureObligations([]);
    setErasureAuthority(null);
    setErasureEvidenceSha256("");
    setErasureCaseReference("");
    setErasureActionId(null);
    setErasureQueueError(null);
    setAttemptsBaseline(null);
    return invalidateErasureRequests;
  }, [candidateId, invalidateErasureRequests, open]);

  const refreshErasureQueue = useCallback(async () => {
    if (!open || role !== "admin" || !supabaseEnabled || !candidateId || !candidateCampaignId) {
      return;
    }
    const { controller, scope } = beginErasureRequest();
    if (!isErasureScopeCurrent(scope)) {
      releaseErasureRequest(controller);
      return;
    }
    try {
      const response = await fetch("/api/admin/candidates/erasure", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "list" }),
        signal: controller.signal,
      });
      if (!isErasureScopeCurrent(scope)) return;
      const body: unknown = await response.json().catch(() => null);
      if (!isErasureScopeCurrent(scope)) return;
      if (!response.ok || body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("queue unavailable");
      }
      const requests = (body as Record<string, unknown>).requests;
      if (!Array.isArray(requests) || requests.length > 100) throw new Error("invalid queue");
      const matching = requests.find((item) => {
        if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
        const request = item as Record<string, unknown>;
        return request.candidateId === candidateId && request.campaignId === candidateCampaignId;
      });
      if (!matching || typeof matching !== "object" || Array.isArray(matching)) return;
      const request = matching as Record<string, unknown>;
      const status = request.status;
      const obligations = parseCandidateErasureObligations(request.obligations);
      if (
        typeof request.requestId !== "string"
        || typeof status !== "string"
        || ![
          "pending_provider",
          "manual_required",
          "retryable_failure",
          "blocked_legal_hold",
        ].includes(status)
        || obligations === null
      ) throw new Error("invalid queue item");
      setErasureNotice({
        status: status as CandidateErasureStatus,
        requestId: request.requestId,
      });
      setErasureObligations(obligations);
      setErasureQueueError(null);
    } catch {
      if (controller.signal.aborted || !isErasureScopeCurrent(scope)) return;
      setErasureQueueError("The durable provider-erasure queue could not be loaded.");
    } finally {
      releaseErasureRequest(controller);
    }
  }, [
    beginErasureRequest,
    candidateCampaignId,
    candidateId,
    isErasureScopeCurrent,
    open,
    releaseErasureRequest,
    role,
  ]);

  useEffect(() => {
    void refreshErasureQueue();
  }, [refreshErasureQueue]);

  const applyErasureLegalHold = useCallback((
    scope: CandidateErasureScope,
    requestId?: string,
  ) => {
    if (!isErasureScopeCurrent(scope)) return false;
    setErasureAuthority(null);
    setErasureEvidenceSha256("");
    setErasureCaseReference("");
    setErasureNotice((current) => ({
      status: "blocked_legal_hold",
      requestId: requestId ?? current?.requestId,
    }));
    setErasureQueueError(
      "Erasure is blocked by a legal hold. Decrypted provider authority was cleared.",
    );
    toast({
      title: "Erasure blocked by legal hold",
      description: "No erasure state transition was recorded. Decrypted provider authority was cleared.",
      variant: "warning",
    });
    return true;
  }, [isErasureScopeCurrent, toast]);

  // Stop polling on unmount so a closed drawer never keeps hitting
  // /api/source/seamless/research-status in the background.
  useEffect(
    () => () => {
      if (seamlessPollTimer.current) clearInterval(seamlessPollTimer.current);
    },
    [],
  );

  // Latest drafted/queued outreach for this candidate (any status — Draft
  // through Scheduled), newest first, so the "why this person" chips below
  // always reflect the most recent personalization. View-only lookup via the
  // existing useOutreach() selector — no new store state.
  const outreach = useOutreach();
  const latestOutreachMessage = useMemo(() => {
    if (!candidateId) return undefined;
    return outreach
      .filter((m) => m.candidateId === candidateId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [outreach, candidateId]);

  // Debounce timers are keyed to this component instance, not to `open` — they
  // must keep running even if the drawer is closed mid-edit (Escape/backdrop)
  // so an in-flight edit still commits instead of being silently discarded.
  // If the component itself unmounts (e.g. navigating away from /candidates)
  // while a debounce is still pending, flush the latest value immediately
  // rather than just clearing the timer — otherwise the edit is silently lost.
  useEffect(
    () => () => {
      if (rejectionTimer.current) clearTimeout(rejectionTimer.current);
      if (phoneTimer.current) clearTimeout(phoneTimer.current);
      if (pendingRejection.current) {
        actionsRef.current.setRejectionReason(pendingRejection.current.id, pendingRejection.current.value);
      }
      if (pendingPhone.current) {
        actionsRef.current.setCandidatePhone(pendingPhone.current.id, pendingPhone.current.value);
      }
    },
    [],
  );

  if (!candidate) {
    return (
      <Drawer open={false} onClose={onClose} title="Candidate">
        <div />
      </Drawer>
    );
  }

  const c = liveCandidate ?? candidate;
  const erasureTombstone = isCandidateErasureTombstone(c);
  const purpose = hasOutreachPurpose(c.stage);
  const masked = confidentialityMode && !purpose && !revealed;
  const dc = applyConfidentiality(c, {
    confidentialityMode,
    reveal: purpose || revealed,
  });
  const flags = c.complianceFlags;
  const hasFlags =
    flags.doNotContact ||
    flags.suppressed ||
    flags.unsubscribed ||
    flags.anonymized ||
    flags.gdprExportRequested;

  const campaignPaused = campaign?.status === "Paused";

  const handleGenerate = async () => {
    if (campaignPaused) {
      toast({
        title: "Campaign is paused",
        description: `${campaign?.title} is paused. Resume it before drafting new outreach.`,
        variant: "warning",
      });
      return;
    }
    setGenerating(true);
    let msg: Awaited<ReturnType<typeof actions.generateOutreachLive>> = null;
    try {
      msg = await actions.generateOutreachLive(c.id);
    } catch {
      if (supabaseEnabled && !demoLoginEnabled) {
        toast({
          title: "Live draft failed",
          description: "Enterprise tenants require a live Aria draft. Check runtime/provider settings and retry.",
          variant: "error",
        });
      } else {
        msg = actions.generateOutreachFor(c.id);
        toast({ title: "Aria is unavailable, used the template draft instead.", variant: "info" });
      }
    }
    setGenerating(false);
    if (msg) {
      toast({
        title: "Outreach drafted",
        description: `${c.name}: review in the outreach queue.`,
        variant: "success",
      });
    } else if (!(supabaseEnabled && !demoLoginEnabled)) {
      toast({ title: "Could not generate outreach", variant: "error" });
    } else {
      toast({
        title: "Live draft required",
        description: "No mock template draft on live tenants.",
        variant: "error",
      });
    }
  };

  const handleSetStage = (stage: CandidateStage) => {
    if (erasureTombstone) return;
    actions.setCandidateStage(c.id, stage);
    toast({
      title: `Stage updated: ${stage}`,
      description:
        stage === "Hired"
          ? `${c.name} moved to Hired. Consider marking ${campaign?.title ?? "the campaign"} as Filled once the req is closed.`
          : stage === "Rejected"
            ? `${c.name} moved to Rejected. Add a rejection reason below.`
            : `${c.name} moved to ${stage}.`,
      variant: stage === "Rejected" ? "warning" : "success",
    });
  };

  const handleAddNote = () => {
    if (erasureTombstone) return;
    const clean = noteText.trim();
    if (!clean) return;
    actions.addCandidateNote(c.id, clean);
    setNoteText("");
    toast({ title: "Note added", description: `Logged to ${c.name}'s activity trail.`, variant: "success" });
  };

  // Committed on every keystroke (debounced), not onBlur — so an edit isn't lost
  // if the user hits Escape before ever blurring the field (see CAND-P0-1).
  const handleRejectionReasonChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (erasureTombstone) return;
    const value = e.target.value;
    pendingRejection.current = { id: c.id, value };
    if (rejectionTimer.current) clearTimeout(rejectionTimer.current);
    rejectionTimer.current = setTimeout(() => {
      pendingRejection.current = null;
      if (value.trim() !== (c.rejectionReason ?? "").trim()) {
        actions.setRejectionReason(c.id, value);
      }
    }, 400);
  };

  const handlePhoneChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (erasureTombstone) return;
    const value = e.target.value;
    pendingPhone.current = { id: c.id, value };
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    phoneTimer.current = setTimeout(() => {
      pendingPhone.current = null;
      actions.setCandidatePhone(c.id, value);
    }, 400);
  };

  // Guards every Drawer close path (Escape, backdrop click, the X button all
  // funnel through the single `onClose` prop) against silently discarding a
  // typed-but-not-"Add"-clicked recruiter note (see CAND-P0-1).
  const handleClose = async () => {
    if (noteText.trim()) {
      const proceed = await confirm({
        title: "Discard unsaved note?",
        description: "You have a recruiter note that hasn't been added yet. Closing now will discard it.",
        confirmLabel: "Discard note",
        danger: true,
      });
      if (!proceed) return;
    }
    onClose();
  };

  const handleBook = async () => {
    const res = await actions.createBookingFor(c.id);
    if (res.ok) {
      toast({
        title: "Interview booked",
        description: `With ${res.booking.interviewer || "an interviewer to be confirmed"}. ${bookingCalendarSummary(res.booking)}`,
        variant: "success",
      });
    } else {
      toast({ title: "Could not book interview", description: res.error, variant: "error" });
    }
  };

  const handleExport = () => {
    const json = actions.exportCandidate(c.id);
    downloadText(`candidate-${c.id}.json`, json, "application/json");
    toast({
      title: "Data exported",
      description: "GDPR data package downloaded as JSON.",
      variant: "success",
    });
  };

  const handleAnonymize = async () => {
    if (erasureTombstone) return;
    const scope = captureErasureScope();
    const confirmed = await confirm({ title: `Anonymize ${c.name}?`, description: "This removes operational candidate data and provider receipts. Required suppression records follow their controlled retention policy. This cannot be undone.", confirmLabel: "Anonymize", danger: true });
    if (!isErasureScopeCurrent(scope) || !confirmed) return;
    if (rejectionTimer.current) clearTimeout(rejectionTimer.current);
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    rejectionTimer.current = null;
    phoneTimer.current = null;
    pendingRejection.current = null;
    pendingPhone.current = null;
    setErasing(true);
    try {
      const result = await actions.anonymizeCandidate(c.id);
      if (!isErasureScopeCurrent(scope)) return;
      if (!result.ok) {
        if (result.status === "blocked_legal_hold") {
          applyErasureLegalHold(scope, result.requestId);
          await refreshErasureQueue();
          if (!isErasureScopeCurrent(scope)) return;
          return;
        }
        if (result.status) {
          setErasureNotice({ status: result.status, requestId: result.requestId });
          setErasureObligations([]);
        }
        toast({
          title: "Candidate anonymization failed",
          description: result.error,
          variant: "error",
        });
        return;
      }
      setErasureAuthority(null);
      setErasureEvidenceSha256("");
      setErasureCaseReference("");
      invalidateErasureRequests();
      onClose();
      if (result.completed) {
        toast({
          title: "Candidate erasure completed",
          description: result.workspaceRefreshRequired
            ? "Server erasure completed. Refresh the workspace before reopening this record."
            : "Candidate data was scrubbed and the permanent suppression tombstone is in place.",
          variant: "success",
        });
        return;
      }
      toast({
        title: "Provider action required",
        description: result.status === "manual_required"
          ? "Candidate data was scrubbed. Reopen the tombstone to record manual provider deletion evidence."
          : result.status === "retryable_failure"
            ? "Candidate data was scrubbed. Reopen the tombstone to retry the provider deletion record."
            : "Candidate data was scrubbed. Reopen the tombstone to manage the pending provider deletion.",
        variant: "warning",
      });
    } catch {
      if (!isErasureScopeCurrent(scope)) return;
      toast({
        title: "Candidate anonymization failed",
        description: "Candidate erasure did not return a valid completion receipt.",
        variant: "error",
      });
    } finally {
      if (isErasureScopeCurrent(scope)) setErasing(false);
    }
  };

  const handleInspectErasureAuthority = async (obligation: CandidateErasureObligation) => {
    const { controller, scope } = beginErasureRequest();
    if (!isErasureScopeCurrent(scope)) {
      releaseErasureRequest(controller);
      return;
    }
    setErasureActionId(obligation.id);
    setErasureQueueError(null);
    try {
      const response = await fetch("/api/admin/candidates/erasure", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "inspect", obligationId: obligation.id }),
        signal: controller.signal,
      });
      if (!isErasureScopeCurrent(scope)) return;
      const body: unknown = await response.json().catch(() => null);
      if (!isErasureScopeCurrent(scope)) return;
      if (isCandidateErasureLegalHoldResponse(response, body)) {
        applyErasureLegalHold(scope);
        await refreshErasureQueue();
        if (!isErasureScopeCurrent(scope)) return;
        return;
      }
      if (!response.ok || body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("authority unavailable");
      }
      const result = body as Record<string, unknown>;
      if (
        result.ok !== true
        || result.obligationId !== obligation.id
        || typeof result.provider !== "string"
        || !Number.isInteger(result.attemptCount)
        || result.reference === null
        || typeof result.reference !== "object"
        || Array.isArray(result.reference)
      ) throw new Error("invalid authority");
      setErasureAuthority({
        obligationId: obligation.id,
        provider: result.provider,
        attemptCount: Number(result.attemptCount),
        reference: result.reference as Record<string, unknown>,
      });
      setErasureEvidenceSha256("");
      setErasureCaseReference("");
    } catch {
      if (controller.signal.aborted || !isErasureScopeCurrent(scope)) return;
      setErasureAuthority(null);
      setErasureEvidenceSha256("");
      setErasureCaseReference("");
      setErasureQueueError("The provider deletion reference could not be opened.");
    } finally {
      releaseErasureRequest(controller);
      if (isErasureScopeCurrent(scope)) setErasureActionId(null);
    }
  };

  const handleCompleteErasureObligation = async () => {
    if (!erasureAuthority) return;
    const authority = erasureAuthority;
    const evidenceSha256 = erasureEvidenceSha256.trim().toLowerCase();
    const caseReference = erasureCaseReference.trim();
    if (!/^[0-9a-f]{64}$/.test(evidenceSha256)) {
      setErasureQueueError("Evidence SHA-256 must be exactly 64 hexadecimal characters.");
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$/.test(caseReference)) {
      setErasureQueueError("Case reference must use 1–120 safe reference characters.");
      return;
    }
    const { controller, scope } = beginErasureRequest();
    if (!isErasureScopeCurrent(scope)) {
      releaseErasureRequest(controller);
      return;
    }
    setErasureActionId(authority.obligationId);
    setErasureQueueError(null);
    try {
      const response = await fetch("/api/admin/candidates/erasure", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "complete",
          obligationId: authority.obligationId,
          expectedAttemptCount: authority.attemptCount,
          evidenceSha256,
          caseReference,
        }),
        signal: controller.signal,
      });
      if (!isErasureScopeCurrent(scope)) return;
      const body: unknown = await response.json().catch(() => null);
      if (!isErasureScopeCurrent(scope)) return;
      if (isCandidateErasureLegalHoldResponse(response, body)) {
        applyErasureLegalHold(scope);
        await refreshErasureQueue();
        if (!isErasureScopeCurrent(scope)) return;
        return;
      }
      if (!response.ok || body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("completion unavailable");
      }
      const result = body as Record<string, unknown>;
      const status = result.status;
      const obligations = parseCandidateErasureObligations(result.obligations);
      if (
        result.ok !== true
        || typeof result.requestId !== "string"
        || typeof status !== "string"
        || !["pending_provider", "manual_required", "retryable_failure", "completed"].includes(status)
        || obligations === null
        || (status === "completed") !== (result.completed === true)
      ) throw new Error("invalid completion receipt");
      setErasureNotice({
        status: status as CandidateErasureStatus,
        requestId: result.requestId,
      });
      setErasureObligations(obligations);
      setErasureAuthority(null);
      setErasureEvidenceSha256("");
      setErasureCaseReference("");
      toast({
        title: status === "completed" ? "Candidate erasure completed" : "Provider deletion recorded",
        description: status === "completed"
          ? "Every provider obligation now has an administrator-recorded evidence reference."
          : "Other provider obligations remain in the durable queue.",
        variant: status === "completed" ? "success" : "warning",
      });
    } catch {
      if (controller.signal.aborted || !isErasureScopeCurrent(scope)) return;
      setErasureAuthority(null);
      setErasureEvidenceSha256("");
      setErasureCaseReference("");
      setErasureQueueError("Provider deletion completion was not recorded. Refresh and retry.");
    } finally {
      releaseErasureRequest(controller);
      if (isErasureScopeCurrent(scope)) setErasureActionId(null);
    }
  };

  const handleSuppress = async () => {
    if (erasureTombstone) return;
    if (
      !(await confirm({
        title: `Suppress contact with ${c.name}?`,
        description: "They'll be excluded from outreach and their stage will show as Suppressed. Use \"Undo: restore contact\" in Compliance below to reverse this.",
        confirmLabel: "Suppress",
        danger: true,
      }))
    )
      return;
    actions.suppressCandidate(c.id);
    toast({ title: "Contact suppressed", description: `${c.name} moved out of active outreach.`, variant: "warning" });
  };

  const handleDoNotContact = async () => {
    if (erasureTombstone) return;
    if (
      !(await confirm({
        title: `Mark ${c.name} as do-not-contact?`,
        description: "This is a hard exclusion: their stage will show as Suppressed. Use \"Undo: restore contact\" in Compliance below to reverse this.",
        confirmLabel: "Mark do-not-contact",
        danger: true,
      }))
    )
      return;
    actions.markDoNotContact(c.id);
    toast({ title: "Marked do-not-contact", description: `${c.name} added to the exclusion list.`, variant: "warning" });
  };

  const handleEnrichApollo = async () => {
    setEnrichingApollo(true);
    try {
      const prepared = await actions.prepareApolloEnrichment(c.id);
      if (!prepared.ok) {
        toast({
          title: prepared.code === "APOLLO_QUOTA_EXCEEDED"
            ? "Apollo limit reached"
            : prepared.code === "APOLLO_RECONCILIATION_REQUIRED"
              ? "Reconciliation required"
              : "Apollo enrichment unavailable",
          description: prepared.error,
          variant: "error",
        });
        return;
      }

      if (!(await confirm({
        title: `Enrich ${c.name} via Apollo?`,
        description: "Reveals email only for this candidate and may use up to 1 Apollo credit.",
        confirmLabel: "Reveal email (up to 1 credit)",
      }))) {
        return;
      }

      const res = await actions.enrichApolloCandidate(c.id, prepared.confirmationNonce);
      toast({
        title: res.revealed
          ? "Email revealed"
          : res.ok
            ? "No email found"
            : res.code === "APOLLO_RECONCILIATION_REQUIRED" || res.code === "APOLLO_OUTCOME_UNKNOWN"
              ? "Reconciliation required"
              : res.code === "APOLLO_RETRY_REQUIRES_NEW_CONFIRMATION" || res.code === "APOLLO_CONFIRMATION_INVALID"
                ? "New confirmation required"
                : res.code === "APOLLO_QUOTA_EXCEEDED"
                  ? "Apollo limit reached"
                  : "Enrichment failed",
        description: res.detail,
        variant: res.revealed ? "success" : res.ok ? "info" : "error",
      });
    } finally {
      setEnrichingApollo(false);
    }
  };

  // Unified cross-provider enrichment (docs/superpowers/plans/
  // 2026-07-15-enrichment-orchestrator.md) — runs the cost-ordered waterfall
  // across every configured provider that can identify this candidate,
  // regardless of which platform originally sourced them. Complements
  // (does not replace) the single-provider Apollo/Seamless actions above.
  const handleEnrich = async () => {
    setAttemptsBaseline((c.enrichment?.attempts ?? []).length);
    setEnriching(true);
    const res = await actions.enrichCandidate(c.id);
    setEnriching(false);
    toast({
      title: res.ok ? (res.filled.length > 0 ? "Enrichment complete" : "No new data found") : "Enrichment failed",
      description: res.detail,
      variant: res.ok ? (res.filled.length > 0 ? "success" : "info") : "error",
    });
  };

  const handleRevealSeamless = async () => {
    if (
      !(await confirm({
        title: `Reveal ${c.name}'s contact via Seamless?`,
        description: "Starts an async research job to find their email/phone. Costs Seamless research credits.",
        confirmLabel: "Reveal contact",
      }))
    )
      return;
    const start = await actions.startSeamlessResearch(c.id);
    if (!start.ok) {
      toast({ title: "Seamless research failed to start", description: start.error, variant: "error" });
      return;
    }
    setRevealingSeamless(true);
    const candidateId = c.id;
    const requestId = start.requestId;
    seamlessPollTimer.current = setInterval(async () => {
      const res = await actionsRef.current.checkSeamlessResearch(candidateId, requestId);
      if (res.ok && res.status === "processing") return; // keep polling
      if (seamlessPollTimer.current) clearInterval(seamlessPollTimer.current);
      seamlessPollTimer.current = null;
      setRevealingSeamless(false);
      if (!res.ok) {
        toast({ title: "Seamless research failed", description: res.error, variant: "error" });
        return;
      }
      toast({
        title: res.revealed ? "Contact details revealed" : "No contact details found",
        description: res.revealed ? "Revealed via Seamless." : "Research completed but found no email or phone.",
        variant: res.revealed ? "success" : "info",
      });
    }, 4_000);
  };

  const handleUnsubscribe = async () => {
    if (erasureTombstone) return;
    if (
      !(await confirm({
        title: `Unsubscribe ${c.name}?`,
        description: "Honors their GDPR unsubscribe request. They'll be excluded from all future outreach.",
        confirmLabel: "Unsubscribe",
        danger: true,
      }))
    )
      return;
    actions.unsubscribeCandidate(c.id);
    toast({ title: "Unsubscribed", description: `${c.name} will no longer receive outreach.`, variant: "warning" });
  };

  const handleRestoreContact = async () => {
    if (erasureTombstone) return;
    if (
      !(await confirm({
        title: `Restore contact with ${c.name}?`,
        description: "This clears the suppressed / do-not-contact flags and restores their pipeline stage.",
        confirmLabel: "Restore",
      }))
    )
      return;
    actions.restoreCandidateContact(c.id);
    toast({ title: "Contact restored", description: `${c.name} is eligible for outreach again.`, variant: "success" });
  };

  const handleReveal = () => {
    if (revealed) return;
    setRevealed(true);
    actions.recordPiiReveal(c.id);
    toast({
      title: "Access logged",
      description: "Contact details revealed; this reveal was written to the audit trail.",
      variant: "info",
    });
  };

  const contactBlocked = erasureTombstone || flags.doNotContact || flags.suppressed || flags.unsubscribed;

  // Unified enrichment panel derivations. `coverage` is the source of truth
  // for "is this field present" (a homed field like email can be present from
  // sourcing time with no provenance record); `fieldProvenance` supplies the
  // "who filled it" badge only when known — a covered-but-unattributed field
  // (legacy/manual data) still renders as filled, just without a provider tag.
  const canEnrich = can(role, "source");
  const enrichmentCoverage = computeCoverage(c);
  const fieldProvenance: Partial<Record<EnrichableField, FieldProvenance>> = c.enrichment?.fieldProvenance ?? {};
  const eligibleProviders = ENRICHMENT_PROVIDERS.filter((p) => p.keyField(c) != null);
  const enrichmentSpend = (c.enrichment?.attempts ?? []).reduce((sum, a) => sum + a.costUnits, 0);
  const recentEnrichmentAttempts: EnrichmentAttempt[] =
    attemptsBaseline !== null ? (c.enrichment?.attempts ?? []).slice(attemptsBaseline) : [];

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="md"
        leftIcon={<Send className="h-4 w-4" />}
        onClick={handleGenerate}
        loading={generating}
        disabled={contactBlocked || campaignPaused || generating}
        title={
          contactBlocked
            ? "Candidate is suppressed / do-not-contact"
            : campaignPaused
              ? "Campaign is paused. Resume it to draft outreach"
              : undefined
        }
      >
        {generating ? "Drafting…" : "Generate outreach"}
      </Button>
      <Button
        variant="primary"
        size="md"
        leftIcon={<CalendarPlus className="h-4 w-4" />}
        onClick={handleBook}
        disabled={contactBlocked}
        title={contactBlocked ? "Candidate is suppressed / do-not-contact" : undefined}
      >
        Book interview
      </Button>
      <Link
        href="/outreach"
        className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-electric hover:bg-electric-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
      >
        Review outreach queue
      </Link>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={dc.name}
      description={
        masked
          ? "Confidential candidate · PII minimized"
          : [c.currentTitle, c.currentCompany].filter(Boolean).join(" @ ") || "Role not provided"
      }
      footer={footer}
      width="max-w-2xl"
    >
      <div className="space-y-8 animate-fade-in">
        <div className="space-y-3">
          {campaign && (
            <Badge tone="electric" size="sm">
              {campaign.title}
            </Badge>
          )}
          {c.provenance === "synthetic" && (
            <Badge tone="warning" size="sm" title="Demo data: not a real sourced profile">
              Synthetic
            </Badge>
          )}
          {c.provenance === "manual" && (
            <Badge tone="warning" size="sm" title="Operator-entered profile">
              Manual
            </Badge>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden />
              {c.location}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden />
              {c.timezone}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" aria-hidden />
              {c.sourcePlatform}
            </span>
          </div>
          <p className="rounded-2xl bg-ink/[0.03] px-3 py-2 font-mono text-xs text-ink-soft break-words">
            {c.sourceQuery}
          </p>
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="inline-flex items-center gap-1.5 text-ink-soft">
                <Mail className="h-4 w-4" aria-hidden />
                <span className={masked ? "font-mono text-muted" : "break-all"}>
                  {dc.email}
                </span>
              </span>
              {masked && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  PII minimized (confidential)
                </span>
              )}
              {!erasureTombstone && c.sourcePlatform === "Apollo" && !c.email && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Zap className="h-4 w-4" />}
                  onClick={handleEnrichApollo}
                  loading={enrichingApollo}
                  disabled={enrichingApollo}
                >
                  {enrichingApollo ? "Preparing…" : "Enrich via Apollo"}
                </Button>
              )}
              {!erasureTombstone && experimentalPaidSourcingEnabled && c.sourcePlatform === "Seamless" && !c.email && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Zap className="h-4 w-4" />}
                  onClick={handleRevealSeamless}
                  loading={revealingSeamless}
                  disabled={revealingSeamless}
                >
                  {revealingSeamless ? "Researching…" : "Reveal via Seamless"}
                </Button>
              )}
            </div>
            {!masked && !erasureTombstone && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <Phone className="h-4 w-4" aria-hidden />
                  <input
                    key={c.id}
                    type="tel"
                    defaultValue={c.phone ?? ""}
                    onChange={handlePhoneChange}
                    placeholder="Add phone for WhatsApp / SMS"
                    aria-label="Candidate phone number"
                    className="w-56 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink placeholder:text-muted"
                  />
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {c.githubUrl &&
                (masked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 font-mono text-xs font-semibold text-muted">
                    <Github className="h-3.5 w-3.5" aria-hidden />
                    {dc.githubUrl}
                  </span>
                ) : (
                  <a
                    href={dc.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/10"
                  >
                    <Github className="h-3.5 w-3.5" aria-hidden />
                    GitHub
                  </a>
                ))}
              {c.linkedinUrl &&
                (masked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 font-mono text-xs font-semibold text-muted">
                    <Linkedin className="h-3.5 w-3.5" aria-hidden />
                    {dc.linkedinUrl}
                  </span>
                ) : (
                  <a
                    href={dc.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/10"
                  >
                    <Linkedin className="h-3.5 w-3.5" aria-hidden />
                    LinkedIn
                  </a>
                ))}
              {c.sourceUrl &&
                (masked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 font-mono text-xs font-semibold text-muted">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {dc.sourceUrl}
                  </span>
                ) : (
                  <a
                    href={dc.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {c.sourcePlatform}
                  </a>
                ))}
              {masked && !erasureTombstone && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Eye className="h-4 w-4" />}
                  onClick={handleReveal}
                >
                  Reveal contact (logged)
                </Button>
              )}
            </div>
          </div>
          {hasFlags && (
            <div className="flex flex-wrap gap-1.5">
              {flags.doNotContact && (
                <Badge tone="danger" size="sm" dot>
                  Do not contact
                </Badge>
              )}
              {flags.suppressed && (
                <Badge tone="danger" size="sm" dot>
                  Suppressed
                </Badge>
              )}
              {flags.unsubscribed && (
                <Badge tone="warning" size="sm" dot>
                  Unsubscribed
                </Badge>
              )}
              {flags.anonymized && (
                <Badge tone="violet" size="sm" dot>
                  Anonymized
                </Badge>
              )}
              {flags.gdprExportRequested && (
                <Badge tone="aqua" size="sm" dot>
                  GDPR export requested
                </Badge>
              )}
            </div>
          )}
        </div>

        <Section title="Enrichment" icon={<Zap className="h-4 w-4" />}>
          {!canEnrich ? (
            <p className="text-sm text-muted">You don&apos;t have permission to enrich candidates.</p>
          ) : (
            <div className="space-y-3">
              <ul className="flex flex-wrap gap-1.5" aria-label="Field coverage">
                {DRAWER_ENRICHMENT_FIELDS.map((field) => {
                  const filled = enrichmentCoverage.includes(field);
                  const prov = fieldProvenance[field];
                  return (
                    <li key={field}>
                      {filled ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success ring-1 ring-inset ring-success/20"
                          title={
                            prov
                              ? `Supplied by ${prov.provider}${prov.confidence !== undefined ? ` · confidence ${Math.round(prov.confidence * 100)}%` : ""}`
                              : "Present (source not tracked)"
                          }
                        >
                          <span className={`h-2 w-2 rounded-full ${confidenceDotTone(prov?.confidence)}`} aria-hidden />
                          {ENRICHMENT_FIELD_LABELS[field]}
                          {prov && <span className="text-[0.625rem] font-medium text-success/70">· {prov.provider}</span>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.04] px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-inset ring-ink/10">
                          <Circle className="h-2.5 w-2.5" aria-hidden />
                          {ENRICHMENT_FIELD_LABELS[field]} · missing
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Zap className="h-4 w-4" />}
                  onClick={handleEnrich}
                  loading={enriching}
                  disabled={enriching}
                >
                  {enriching ? "Enriching…" : "Enrich"}
                </Button>
                <span className="text-xs text-muted">
                  {enrichmentSpend > 0 ? `${enrichmentSpend} unit(s) spent on this candidate` : "No spend yet"}
                </span>
              </div>

              {(enriching || recentEnrichmentAttempts.length > 0) && (
                <ul
                  className="space-y-1.5"
                  role="status"
                  aria-live="polite"
                  aria-label="Enrichment progress by provider"
                >
                  {enriching && eligibleProviders.length === 0 && (
                    <li className="text-sm text-muted">
                      No configured provider can identify this candidate (missing name, company, or LinkedIn URL).
                    </li>
                  )}
                  {enriching
                    ? eligibleProviders.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center gap-2 rounded-xl bg-ink/[0.03] px-3 py-1.5 text-sm text-muted"
                        >
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          {p.label} — running…
                        </li>
                      ))
                    : recentEnrichmentAttempts.map((a, i) => (
                        <li
                          key={`${a.provider}-${a.at}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-xl bg-ink/[0.03] px-3 py-1.5 text-sm"
                        >
                          <span className="font-medium text-ink-soft">{a.provider}</span>
                          <span className="flex items-center gap-2">
                            {a.fieldsFilled.length > 0 && (
                              <span className="text-xs text-muted">
                                {a.fieldsFilled.map((f) => ENRICHMENT_FIELD_LABELS[f]).join(", ")}
                              </span>
                            )}
                            <Badge tone={ATTEMPT_STATUS_TONE[a.status]} size="sm" title={a.detail}>
                              {ATTEMPT_STATUS_LABEL[a.status]}
                            </Badge>
                          </span>
                        </li>
                      ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        <Section title="Match score" icon={<Sparkles className="h-4 w-4" />}>
          <div className="grid gap-6 sm:grid-cols-[auto_auto_1fr] sm:items-start">
            <div className="flex justify-center sm:justify-start">
              <ScoreGauge score={c.matchScore} label="Overall fit" />
            </div>
            <div className="flex justify-center sm:justify-start">
              <FitRadar matchBreakdown={c.matchBreakdown} size={180} label={c.name} />
            </div>
            <ScoreBreakdown breakdown={c.matchBreakdown} />
          </div>
        </Section>

        {/* Why this person — personalization evidence behind the latest
            drafted/queued outreach, if any (view-only; never blank). */}
        {latestOutreachMessage && <WhyThisPerson candidate={c} message={latestOutreachMessage} />}

        {/* TAnIA — source, star rating, prequal, interviews, #Vivier */}
        {!erasureTombstone && <TaniaPanel c={c} />}

        {/* Onboarding journey (Stages III→IV) — only once at offer/hired */}
        {(c.stage === "Offer" || c.stage === "Hired") && <OnboardingPanel c={c} />}

        <Section title="Interview stage" icon={<ClipboardCheck className="h-4 w-4" />}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Current:</span>
            <Badge tone={toneForStage(c.stage)} size="sm" dot>
              {c.stage}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {STAGE_ACTIONS.map((stage) => (
              <Button
                key={stage}
                variant={c.stage === stage ? "primary" : "outline"}
                size="sm"
                disabled={erasureTombstone || c.stage === stage}
                title={erasureTombstone ? "Permanent erasure tombstones cannot change stage" : undefined}
                onClick={() => handleSetStage(stage)}
              >
                {stage}
              </Button>
            ))}
          </div>
          {c.stage === "Rejected" && (
            <div>
              <label
                htmlFor={`rejection-reason-${c.id}`}
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Rejection reason
              </label>
              <textarea
                id={`rejection-reason-${c.id}`}
                key={c.id}
                defaultValue={c.rejectionReason ?? ""}
                onChange={handleRejectionReasonChange}
                disabled={erasureTombstone}
                placeholder="Why was this candidate rejected? Logged to the activity trail."
                rows={2}
                className="w-full rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
              />
            </div>
          )}
        </Section>

        <Section title="Tech stack">
          <Chips items={c.techStack} label="Tech stack" />
        </Section>

        {/* Experience */}
        <Section title="Experience & background" icon={<Briefcase className="h-4 w-4" />}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Experience</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink tabular-nums">
                {c.yearsExperience == null ? "Not provided" : `${c.yearsExperience} yrs`}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-2">
              <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <Building2 className="h-3.5 w-3.5" aria-hidden />
                Company stages
              </dt>
              <dd className="mt-1">
                <Chips items={c.companyStageExperience} label="Company stage experience" />
              </dd>
            </div>
          </dl>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Industry</p>
            <Chips items={c.industryExperience} label="Industry experience" />
          </div>
          {c.experience?.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Work history</p>
              <ul className="space-y-1 text-sm leading-relaxed text-ink-soft">
                {c.experience.map((line, i) => (
                  <li key={`exp-${i}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.education?.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Education</p>
              <ul className="space-y-1 text-sm leading-relaxed text-ink-soft">
                {c.education.map((line, i) => (
                  <li key={`edu-${i}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.languages?.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Languages</p>
              <Chips items={c.languages} label="Languages" />
            </div>
          ) : null}
        </Section>

        <Section title="Recent activity" icon={<Clock className="h-4 w-4" />}>
          <p className="text-sm leading-relaxed text-ink-soft">{c.recentActivity}</p>
        </Section>

        <Section title="Recruiter notes" icon={<NotebookPen className="h-4 w-4" />}>
          <div className="flex items-start gap-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              disabled={erasureTombstone}
              placeholder="Add a note for the team…"
              rows={2}
              aria-label="Add a recruiter note"
              className="min-h-[44px] flex-1 rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
            <Button variant="outline" size="sm" onClick={handleAddNote} disabled={erasureTombstone || !noteText.trim()}>
              Add
            </Button>
          </div>
          {(c.notes?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {(c.notes ?? []).map((n) => (
                <li key={n.id} className="rounded-2xl bg-ink/[0.03] px-3 py-2">
                  <p className="text-sm text-ink-soft">{n.text}</p>
                  <p className="mt-1 text-xs text-muted">{formatTimeAgo(n.at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Outreach history" icon={<Send className="h-4 w-4" />}>
          {c.outreachHistory.length === 0 ? (
            <p className="text-sm text-muted">No outreach sent yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.outreachHistory.map((o) => (
                <li
                  key={o.messageId}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-ink/[0.03] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{o.subject}</p>
                    <p className="text-xs text-muted">
                      {o.channel} · {formatTimeAgo(o.at)}
                    </p>
                  </div>
                  <Badge tone={toneForOutreachStatus(o.status)} size="sm">
                    {o.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Reply history" icon={<MessageSquare className="h-4 w-4" />}>
          {c.replyHistory.length === 0 ? (
            <p className="text-sm text-muted">No replies received yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.replyHistory.map((r) => (
                <li key={r.id} className="rounded-2xl bg-ink/[0.03] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={toneForIntent(r.intent)} size="sm">
                      {r.intent.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted tabular-nums">
                      {Math.round(r.confidence * 100)}% · {formatTimeAgo(r.at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-soft">{r.excerpt}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Compliance & data governance" icon={<ShieldAlert className="h-4 w-4" />}>
          <p className="text-sm text-muted">
            Honor candidate rights immediately. Export and anonymize support GDPR; suppression and
            do-not-contact enforce exclusion across all outreach.
          </p>
          {erasureNotice && (
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                erasureNotice.status === "completed"
                  ? "border-success/30 bg-success/5 text-success"
                  : erasureNotice.status === "blocked_legal_hold"
                    ? "border-danger/30 bg-danger/5 text-danger"
                    : "border-warning/30 bg-warning/5 text-warning"
              }`}
              role="status"
            >
              <p className="font-semibold">
                {erasureNotice.status === "completed"
                  ? "Candidate erasure completed"
                  : erasureNotice.status === "blocked_legal_hold"
                    ? "Erasure blocked by legal hold"
                    : erasureNotice.status === "manual_required"
                      ? "Provider action required"
                      : erasureNotice.status === "retryable_failure"
                        ? "Provider erasure retry required"
                        : "Provider erasure pending"}
              </p>
              {erasureNotice.requestId && (
                <p className="mt-1 font-mono text-xs opacity-80">
                  Request {erasureNotice.requestId}
                </p>
              )}
            </div>
          )}
          {erasureQueueError && (
            <p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
              {erasureQueueError}
            </p>
          )}
          {erasureObligations.some((item) => item.status !== "completed") && (
            <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
              <div>
                <p className="text-sm font-semibold text-ink">Durable provider-erasure queue</p>
                <p className="mt-1 text-xs text-muted">
                  Provider deletion is not complete until an administrator confirms the provider outcome in the approved case system and records its evidence reference.
                </p>
              </div>
              <ul className="space-y-2">
                {erasureObligations.filter((item) => item.status !== "completed").map((obligation) => (
                  <li key={obligation.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{obligation.provider}</p>
                      <p className="text-xs text-muted">
                        {obligation.status.replaceAll("_", " ")} · attempt {obligation.attemptCount}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={erasureActionId !== null}
                      onClick={() => void handleInspectErasureAuthority(obligation)}
                    >
                      {erasureActionId === obligation.id ? "Opening…" : "Open authority"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {erasureAuthority && (
            <div className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
              <div>
                <p className="text-sm font-semibold text-ink">
                  Record {erasureAuthority.provider} deletion evidence
                </p>
                <p className="mt-1 text-xs text-muted">
                  Sensitive provider authority is decrypted only for this explicit admin action. ARIA records the reference and SHA-256 but does not inspect the evidence artifact or contact the provider.
                </p>
              </div>
              <pre className="max-h-40 overflow-auto rounded-lg bg-ink p-3 text-xs text-white">
                {JSON.stringify(erasureAuthority.reference, null, 2)}
              </pre>
              <div className="space-y-1.5">
                <Label htmlFor={`candidate-erasure-evidence-${erasureAuthority.obligationId}`}>
                  Provider evidence SHA-256
                </Label>
                <Input
                  id={`candidate-erasure-evidence-${erasureAuthority.obligationId}`}
                  value={erasureEvidenceSha256}
                  onChange={(event) => setErasureEvidenceSha256(event.target.value)}
                  placeholder="64 lowercase hexadecimal characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`candidate-erasure-case-${erasureAuthority.obligationId}`}>
                  Provider case reference
                </Label>
                <Input
                  id={`candidate-erasure-case-${erasureAuthority.obligationId}`}
                  value={erasureCaseReference}
                  onChange={(event) => setErasureCaseReference(event.target.value)}
                  placeholder="case:provider-123"
                  maxLength={120}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={erasureActionId !== null}
                  onClick={() => void handleCompleteErasureObligation()}
                >
                  {erasureActionId === erasureAuthority.obligationId
                    ? "Recording…"
                    : "Record evidence reference"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={erasureActionId !== null}
                  onClick={() => setErasureAuthority(null)}
                >
                  Close authority
                </Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={handleExport}>
              Export data
            </Button>
            {!erasureTombstone && (
              <>
                <Button variant="outline" size="sm" leftIcon={<UserX className="h-4 w-4" />} onClick={handleAnonymize} disabled={erasing}>
                  {erasing ? "Erasing…" : "Anonymize"}
                </Button>
                <Button variant="outline" size="sm" leftIcon={<EyeOff className="h-4 w-4" />} onClick={handleSuppress}>
                  Suppress contact
                </Button>
                <Button variant="danger" size="sm" leftIcon={<Ban className="h-4 w-4" />} onClick={handleDoNotContact}>
                  Mark do-not-contact
                </Button>
                <Button variant="outline" size="sm" leftIcon={<MailX className="h-4 w-4" />} onClick={handleUnsubscribe}>
                  Unsubscribe
                </Button>
              </>
            )}
          </div>
          {!erasureTombstone && (flags.suppressed || flags.doNotContact) && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw className="h-4 w-4" />}
              onClick={handleRestoreContact}
            >
              Undo: restore contact
            </Button>
          )}
        </Section>

        {/* Consent passport — GDPR data lineage: source/lawful-basis chips,
            retention countdown, and the reveal ledger for this candidate.
            Display-only; does not itself reveal masked PII. */}
        <Section title="Consent passport" icon={<ShieldCheck className="h-4 w-4" />}>
          <ConsentPassport candidate={c} />
        </Section>
      </div>
    </Drawer>
  );
}
