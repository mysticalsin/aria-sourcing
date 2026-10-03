"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Eyebrow,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import {
  SAMPLE_INTAKE_EMAIL,
  SAMPLE_INTAKE_JD,
  SAMPLE_MANTU_EMAIL,
  isNeedEmail,
  type ParsedIntake,
} from "@/lib/mock-ai";
import type { InboundMessage } from "@/lib/email-sync";
import { parseIntakeLive, deriveValidationWarnings } from "@/lib/ai/intake";
import { OutlookNeedsPanel } from "@/components/intake/outlook-needs-panel";
import type { OutlookNeedMessage } from "@/lib/outlook-needs";
import { useActions, useCampaigns, useHydrated, useSettings } from "@/lib/store";
import { supabaseEnabled } from "@/lib/supabase/config";
import {
  copyToClipboard,
  formatPercent,
  formatSalaryRange,
  scoreTone,
  toneForUrgency,
  type Tone,
} from "@/lib/utils";
import {
  SENIORITY_LEVELS,
  EMPLOYMENT_TYPES,
  LOCATION_TYPES,
  URGENCY_LEVELS,
  type IntakeIntent,
  type JobAnalysis,
  type Seniority,
  type Urgency,
  type ValidationWarning,
} from "@/lib/types";
import {
  AlertCircle,
  AlertTriangle,
  Copy,
  FileText,
  Info,
  Inbox,
  Plus,
  Rocket,
  ScanText,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

const INTENT_TONE: Record<IntakeIntent, Tone> = {
  "New Role": "electric",
  Backfill: "violet",
  "Urgent Hire": "tangerine",
  Exploratory: "neutral",
};

const SEVERITY_TONE: Record<ValidationWarning["severity"], Tone> = {
  critical: "danger",
  warning: "warning",
  info: "electric",
};

const SEVERITY_ICON: Record<ValidationWarning["severity"], React.ReactNode> = {
  critical: <AlertTriangle className="h-4 w-4" aria-hidden />,
  warning: <AlertCircle className="h-4 w-4" aria-hidden />,
  info: <Info className="h-4 w-4" aria-hidden />,
};

export default function IntakePage() {
  const hydrated = useHydrated();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const actions = useActions();
  const settings = useSettings();
  const campaigns = useCampaigns();

  const [email, setEmail] = useState("");
  const [jd, setJd] = useState("");
  const [parsed, setParsed] = useState<ParsedIntake | null>(null);
  const [job, setJob] = useState<JobAnalysis | null>(null);
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [skillDraft, setSkillDraft] = useState("");
  const [dustPending, setDustPending] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [selectedNeedId, setSelectedNeedId] = useState<string | null>(null);
  // Guards against a slow Dust reply from an earlier parse landing on top of a
  // newer one if the user re-parses before the first call resolves.
  const parseSeqRef = React.useRef(0);
  // Same guard, for the live LLM parse itself — a slower earlier parse can't
  // clobber a faster, more recent one if the user re-parses quickly.
  const liveParseSeqRef = React.useRef(0);

  function patchJob(patch: Partial<JobAnalysis>) {
    setJob((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // Recomputed from the live, editable `job` state (not the frozen parse-time
  // `parsed.validationWarnings`) so adding/removing skills or filling in salary
  // actually clears/raises warnings, and the create-campaign gate below can't
  // go stale relative to what's on screen.
  const liveValidationWarnings = React.useMemo(
    () => (job ? deriveValidationWarnings(job) : []),
    [job],
  );

  /** Enrichment on top of the heuristic parse above — never blocks or replaces it.
   * The server-owned Dust authority decides whether an agent is locked; any
   * unconfigured/network/provider failure simply leaves `dustAnalysis` unset. */
  function maybeRunDustJdAnalysis(rawJd: string, rawEmail: string) {
    const seq = ++parseSeqRef.current;
    setDustPending(false);
    const message = rawJd.trim() || rawEmail;
    if (!message.trim()) return;
    setDustPending(true);
    void actions.runDustTask("jdAnalysis", message).then((res) => {
      if (parseSeqRef.current !== seq) return; // superseded by a newer parse
      setDustPending(false);
      if (res.ok && res.text) {
        const text = res.text;
        setParsed((prev) =>
          prev ? { ...prev, dustAnalysis: { agentId: res.agentId ?? "dust:jdAnalysis", text } } : prev,
        );
      }
    });
  }

  function loadSample() {
    setEmail(SAMPLE_INTAKE_EMAIL);
    setJd(SAMPLE_INTAKE_JD);
    toast({
      title: "Sample loaded",
      description: "An urgent senior backend (Go) brief is ready to parse.",
      variant: "info",
    });
  }

  function loadMantu() {
    setEmail(SAMPLE_MANTU_EMAIL);
    setJd("");
    toast({
      title: "Mantu need loaded",
      description: "A real Mantu/Amaris “need is now ACTIVE” email is ready to parse.",
      variant: "info",
    });
  }

  /** Scans the connected mailbox for hiring-need emails and loads the newest
   * one into the form. A bundled sample is available only in explicit demo
   * mode; a live tenant never substitutes sample data for an empty inbox. */
  async function scanInbox() {
    const seq = ++liveParseSeqRef.current;
    setParsing(true);

    let incoming = "";
    let fromInbox = false;
    let needCount = 0;
    try {
      const res = await fetch("/api/email/sync", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        messages?: (InboundMessage & { seatId: string })[];
      } | null;
      if (res.ok && json?.ok) {
        const needs = (json.messages ?? [])
          .filter((m) => isNeedEmail(m.subject ?? "", m.body ?? ""))
          .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
        needCount = needs.length;
        const newest = needs[0];
        if (newest) {
          incoming = `From: ${newest.from}\nSubject: ${newest.subject}\n\n${newest.body}`;
          fromInbox = true;
        }
      }
    } catch {
      // The live path reports the unavailable mailbox below. Demo mode may load
      // the clearly labelled bundled sample.
    }
    if (liveParseSeqRef.current !== seq) return; // superseded by a newer parse
    if (!incoming && supabaseEnabled) {
      setParsing(false);
      toast({
        title: "No hiring need found",
        description: "The connected mailbox returned no hiring-need email. Nothing was created or substituted.",
        variant: "warning",
      });
      return;
    }
    if (!incoming) incoming = SAMPLE_MANTU_EMAIL;

    setEmail(incoming);
    setJd("");
    const result = await parseIntakeLive(settings, { email: incoming });
    if (liveParseSeqRef.current !== seq) return; // superseded by a newer parse
    setParsing(false);
    setParsed(result);
    setJob(result.jobAnalysis);
    setSenderName(result.sender.name);
    setSenderEmail(result.sender.email);
    maybeRunDustJdAnalysis("", incoming);
    toast({
      title: result.providerWarning
        ? "Need loaded for review"
        : fromInbox
          ? "Need email found in your inbox"
          : "Sample need loaded",
      description: result.providerWarning
        ? result.providerWarning
        : fromInbox
        ? `${result.jobAnalysis.title} parsed from the newest need email${
            needCount > 1 ? ` (${needCount - 1} older need email${needCount > 2 ? "s" : ""} also in the inbox)` : ""
          }.`
        : `No need email found in a connected mailbox. Parsed the sample Mantu need instead. (${result.jobAnalysis.title})`,
      variant: result.providerWarning ? "warning" : fromInbox ? "success" : "info",
    });
  }

  /** Load an Outlook need into the form and immediately parse with the intake LLM. */
  async function handleOutlookNeed(intakeEmail: string, need: OutlookNeedMessage) {
    const seq = ++liveParseSeqRef.current;
    setSelectedNeedId(need.messageId);
    setEmail(intakeEmail);
    setJd("");
    setParsing(true);
    const result = await parseIntakeLive(settings, { email: intakeEmail });
    if (liveParseSeqRef.current !== seq) return;
    setParsing(false);
    setParsed(result);
    setJob(result.jobAnalysis);
    setSenderName(result.sender.name);
    setSenderEmail(result.sender.email);
    maybeRunDustJdAnalysis("", intakeEmail);
    toast({
      title: result.providerWarning ? "Need loaded for review" : "Outlook need parsed",
      description:
        result.providerWarning ??
        `${result.jobAnalysis.title} · review the brief, then create the campaign to start sourcing.`,
      variant: result.providerWarning ? "warning" : "success",
    });
  }

  /** Routes through the live LLM when a cloud provider is configured for chat.
   * Provider failures return a visible warning and an evidence-only parse. */
  async function handleParse() {
    if (!email.trim()) {
      toast({
        title: "Nothing to parse",
        description: "Paste the recruiter email or brief first.",
        variant: "warning",
      });
      return;
    }
    const seq = ++liveParseSeqRef.current;
    setParsing(true);
    const result = await parseIntakeLive(settings, { email, jd: jd.trim() ? jd : undefined });
    if (liveParseSeqRef.current !== seq) return; // superseded by a newer parse
    setParsing(false);
    setParsed(result);
    setJob(result.jobAnalysis);
    setSenderName(result.sender.name);
    setSenderEmail(result.sender.email);
    maybeRunDustJdAnalysis(jd, email);
    toast({
      title: result.providerWarning ? "Brief extracted for review" : "Brief parsed",
      description:
        result.providerWarning ??
        `${result.jobAnalysis.title} · ${result.jobAnalysis.requiredSkills.length} required skills detected.`,
      variant: result.providerWarning ? "warning" : "success",
    });
  }

  function addSkill() {
    const value = skillDraft.trim();
    if (!value || !job) return;
    if (job.requiredSkills.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setSkillDraft("");
      return;
    }
    patchJob({ requiredSkills: [...job.requiredSkills, value] });
    setSkillDraft("");
  }

  function removeSkill(skill: string) {
    if (!job) return;
    patchJob({ requiredSkills: job.requiredSkills.filter((s) => s !== skill) });
  }

  function removeNiceToHave(skill: string) {
    if (!job) return;
    patchJob({ niceToHaveSkills: job.niceToHaveSkills.filter((s) => s !== skill) });
  }

  async function copyClarification() {
    if (!parsed?.clarificationDraft) return;
    const ok = await copyToClipboard(parsed.clarificationDraft);
    toast({
      title: ok ? "Clarification copied" : "Copy failed",
      description: ok
        ? "Paste it into your reply to the hiring manager."
        : "Your browser blocked clipboard access. Select and copy manually.",
      variant: ok ? "success" : "error",
    });
  }

  async function handleCreateCampaign() {
    if (!job || !parsed) return;
    const criticalWarnings = liveValidationWarnings.filter((w) => w.severity === "critical");
    if (criticalWarnings.length > 0) {
      toast({
        title: "Complete the brief before sourcing",
        description: criticalWarnings.map((warning) => warning.message).join(" "),
        variant: "warning",
      });
      return;
    }

    // Duplicate guard: a re-parse-and-create, a double-click, or repeated "Scan
    // inbox" on the same recurring need email shouldn't silently spin up a
    // second campaign (and a second sourcing run) for the same open role.
    const normalizedTitle = job.title.trim().toLowerCase();
    const hiringManagerEmail = senderEmail.trim();
    const duplicate = campaigns.find(
      (c) =>
        c.status !== "Filled" &&
        c.title.trim().toLowerCase() === normalizedTitle &&
        c.hiringManagerEmail.trim().toLowerCase() === hiringManagerEmail.toLowerCase(),
    );
    if (duplicate) {
      const proceed = await confirm({
        title: "Possible duplicate campaign",
        description: `“${duplicate.title}” for ${duplicate.hiringManagerEmail} already exists (${duplicate.status}). Create another campaign for the same role anyway?`,
        confirmLabel: "Create anyway",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!proceed) return;
    }

    const campaign = actions.createCampaignFromAnalysis(job, {
      hiringManager: senderName.trim(),
      hiringManagerEmail,
    });
    if (!campaign) {
      toast({
        title: "Campaign not created",
        description:
          "Your workspace is unavailable or your access is read-only. Retry after access is restored.",
        variant: "error",
      });
      return;
    }
    toast({
      title: "Campaign created",
      description: `${campaign.title} is ready. The first real sourcing search is starting.`,
      variant: "success",
    });

    if (supabaseEnabled) {
      await actions.flushWorkspaceSave();
    }
    const res = await actions.sourceNextBatch(campaign.id);
    if (res.ok) {
      const n = res.accepted.length;
      toast({
        title: n > 0 ? "First sourcing batch complete" : "No candidates were added",
        description: n > 0
          ? `Added ${n} real candidate${n === 1 ? "" : "s"} for ${campaign.title}.`
          : `The first real search for ${campaign.title} completed without a matching result.`,
        variant: n > 0 ? "success" : "info",
      });
    } else {
      toast({
        title: "Sourcing couldn't start",
        description: `${res.error} Retry with “Source next batch” on the campaign page.`,
        variant: "warning",
      });
    }
    router.push(`/campaigns/${campaign.id}`);
  }

  function numberOrNull(raw: string): number | null {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /** ISO datetime -> the yyyy-mm-dd shape <input type="date"> expects. */
  function dateInputValue(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Open needs → sourcing"
        description="Pull hiring needs from Outlook, or paste a brief. Aria parses it into an editable role and starts a real sourcing campaign."
        actions={
          <Badge tone="aqua" dot>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Dry-run · nothing sent
          </Badge>
        }
      />

      <HydrationGate hydrated={hydrated} fallback={<IntakeFallback />}>
        <div className="mb-6">
          <OutlookNeedsPanel
            onSelectNeed={(intakeEmail, need) => {
              void handleOutlookNeed(intakeEmail, need);
            }}
            selectedMessageId={selectedNeedId}
            busy={parsing}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* LEFT — inbound brief form */}
          <Card className="animate-fade-in lg:sticky lg:top-6 lg:self-start">
            <CardHeader>
              <Eyebrow>01: Inbound brief</Eyebrow>
              <CardTitle className="mt-1">Paste the hiring request</CardTitle>
            </CardHeader>
            <CardBody className="space-y-5 pt-0">
              <Field
                label="Recruiter email / brief"
                htmlFor="intake-email"
                hint="The raw email from the hiring manager. The From line and signature improve extraction."
              >
                <Textarea
                  id="intake-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="From: Daniela Brandt <daniela.brandt@northwind.example>&#10;Subject: URGENT - backfill Senior Backend Engineer…"
                  className="min-h-[220px] font-mono text-[0.8125rem]"
                />
              </Field>

              <Field
                label="Job description (optional)"
                htmlFor="intake-jd"
                hint="Optional. Sharpens skills, salary and seniority detection."
              >
                <Textarea
                  id="intake-jd"
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  placeholder="Senior Backend Engineer (Remote, EU)&#10;Requirements: 5+ years…"
                  className="min-h-[160px] font-mono text-[0.8125rem]"
                />
              </Field>

              <div className="space-y-3 border-t border-line pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    leftIcon={<Sparkles aria-hidden />}
                    onClick={loadSample}
                    disabled={parsing}
                  >
                    Sample backend role
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    leftIcon={<FileText aria-hidden />}
                    onClick={loadMantu}
                    disabled={parsing}
                  >
                    Load Mantu need
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    size="sm"
                    leftIcon={<Inbox aria-hidden />}
                    onClick={scanInbox}
                    loading={parsing}
                    disabled={parsing}
                  >
                    Scan inbox
                  </Button>
                  <Button
                    type="button"
                    leftIcon={<ScanText aria-hidden />}
                    onClick={handleParse}
                    loading={parsing}
                    disabled={!email.trim() || parsing}
                    className="ml-auto"
                  >
                    {parsing ? "Parsing…" : "Parse JD"}
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Inbound emails can also POST to{" "}
                  <code className="rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-[0.6875rem] text-ink-soft">
                    /api/intake
                  </code>
                  {". "}A Microsoft Graph / n8n webhook scans the JD email and returns a structured brief.
                </p>
              </div>
            </CardBody>
          </Card>

          {/* RIGHT — structured, editable analysis */}
          {!parsed || !job ? (
            <EmptyState
              className="lg:min-h-[420px]"
              icon={<ScanText className="h-6 w-6" aria-hidden />}
              title="Awaiting a brief"
              description="Parse an email (or load the sample) and the structured, editable analysis (confidence scores, validation, and a clarification draft) appears here."
            />
          ) : (
            <div className="space-y-6 animate-fade-in">
              <Card>
                <CardHeader className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Eyebrow>02: Structured analysis</Eyebrow>
                      <CardTitle className="mt-1">Extracted brief</CardTitle>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <Badge tone={INTENT_TONE[parsed.intent]}>{parsed.intent}</Badge>
                      <Badge tone={toneForUrgency(job.urgency)} dot>
                        {job.urgency}
                      </Badge>
                    </div>
                  </div>

                  {/* Confidence per field */}
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(parsed.confidence).map(([field, value]) => (
                      <Badge key={field} tone={scoreTone(value * 100)} size="sm">
                        {field} {formatPercent(value)}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>

                <CardBody className="space-y-5 pt-0">
                  {/* Hiring manager */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Hiring manager" htmlFor="hm-name">
                      <Input
                        id="hm-name"
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                      />
                    </Field>
                    <Field label="Hiring manager email" htmlFor="hm-email">
                      <Input
                        id="hm-email"
                        type="email"
                        value={senderEmail}
                        onChange={(e) => setSenderEmail(e.target.value)}
                      />
                    </Field>
                  </div>

                  {/* Role + department */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Role title" htmlFor="job-title">
                      <Input
                        id="job-title"
                        value={job.title}
                        onChange={(e) => patchJob({ title: e.target.value })}
                      />
                    </Field>
                    <Field label="Department" htmlFor="job-dept">
                      <Input
                        id="job-dept"
                        value={job.department}
                        onChange={(e) => patchJob({ department: e.target.value })}
                      />
                    </Field>
                  </div>

                  {/* Seniority + employment + urgency */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Seniority" htmlFor="job-seniority">
                      <Select
                        id="job-seniority"
                        value={job.seniority}
                        onChange={(e) => patchJob({ seniority: e.target.value as Seniority })}
                        options={SENIORITY_LEVELS.map((s) => ({ value: s, label: s }))}
                      />
                    </Field>
                    <Field label="Employment type" htmlFor="job-employment-type">
                      <Select
                        id="job-employment-type"
                        value={job.employmentType}
                        onChange={(e) =>
                          patchJob({
                            employmentType: e.target.value as JobAnalysis["employmentType"],
                          })
                        }
                        options={EMPLOYMENT_TYPES.map((type) => ({ value: type, label: type }))}
                      />
                    </Field>
                    <Field label="Urgency" htmlFor="job-urgency">
                      <Select
                        id="job-urgency"
                        value={job.urgency}
                        onChange={(e) => patchJob({ urgency: e.target.value as Urgency })}
                        options={URGENCY_LEVELS.map((u) => ({ value: u, label: u }))}
                      />
                    </Field>
                  </div>

                  {/* Expected start date */}
                  <Field
                    label="Expected start date"
                    htmlFor="job-start-date"
                    hint="From the client's stated start date, when given. Falls back to a default when creating the campaign if left blank."
                  >
                    <Input
                      id="job-start-date"
                      type="date"
                      value={dateInputValue(job.expectedStartDate)}
                      onChange={(e) =>
                        patchJob({
                          expectedStartDate: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : null,
                        })
                      }
                    />
                  </Field>

                  {/* Salary */}
                  <div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Salary min" htmlFor="salary-min">
                        <Input
                          id="salary-min"
                          type="number"
                          inputMode="numeric"
                          value={job.salaryMin ?? ""}
                          onChange={(e) => patchJob({ salaryMin: numberOrNull(e.target.value) })}
                        />
                      </Field>
                      <Field label="Salary max" htmlFor="salary-max">
                        <Input
                          id="salary-max"
                          type="number"
                          inputMode="numeric"
                          value={job.salaryMax ?? ""}
                          onChange={(e) => patchJob({ salaryMax: numberOrNull(e.target.value) })}
                        />
                      </Field>
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      Reads as{" "}
                      <span className="font-semibold text-ink-soft">
                        {formatSalaryRange(job.salaryMin, job.salaryMax, job.currency)}
                      </span>{" "}
                      ({job.currency}
                      {job.equity ? " · equity on the table" : ""})
                    </p>
                  </div>

                  {/* Location */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Location type" htmlFor="loc-type">
                      <Select
                        id="loc-type"
                        value={job.locationType}
                        onChange={(e) =>
                          patchJob({ locationType: e.target.value as JobAnalysis["locationType"] })
                        }
                        options={LOCATION_TYPES.map((l) => ({ value: l, label: l }))}
                      />
                    </Field>
                    <Field label="Regions" htmlFor="loc-regions" hint="Comma-separated">
                      <Input
                        id="loc-regions"
                        value={job.regions.join(", ")}
                        onChange={(e) =>
                          patchJob({
                            regions: e.target.value
                              .split(",")
                              .map((r) => r.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                    <Field label="Timezone" htmlFor="loc-tz">
                      <Input
                        id="loc-tz"
                        value={job.timezone}
                        onChange={(e) => patchJob({ timezone: e.target.value })}
                      />
                    </Field>
                  </div>

                  {/* Years */}
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Min years experience" htmlFor="years-min">
                      <Input
                        id="years-min"
                        type="number"
                        inputMode="numeric"
                        value={job.minYearsExperience ?? ""}
                        onChange={(e) =>
                          patchJob({ minYearsExperience: numberOrNull(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Max years experience" htmlFor="years-max">
                      <Input
                        id="years-max"
                        type="number"
                        inputMode="numeric"
                        value={job.maxYearsExperience ?? ""}
                        onChange={(e) =>
                          patchJob({ maxYearsExperience: numberOrNull(e.target.value) })
                        }
                      />
                    </Field>
                  </div>

                  {/* Required skills — editable chips */}
                  <div>
                    <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
                      Required skills
                    </span>
                    {job.requiredSkills.length === 0 ? (
                      <p className="mb-2 text-xs text-danger">
                        No required skills. Add at least three for a strong sourcing strategy.
                      </p>
                    ) : (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {job.requiredSkills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-flex items-center gap-1 rounded-full bg-tangerine-soft py-1 pl-3 pr-1.5 text-xs font-semibold text-tangerine ring-1 ring-inset ring-tangerine/20"
                          >
                            {skill}
                            <button
                              type="button"
                              onClick={() => removeSkill(skill)}
                              aria-label={`Remove ${skill}`}
                              className="grid h-4 w-4 place-items-center rounded-full text-tangerine/70 transition hover:bg-tangerine/15 hover:text-tangerine"
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        addSkill();
                      }}
                      className="flex gap-2"
                    >
                      <Input
                        id="skill-add"
                        value={skillDraft}
                        onChange={(e) => setSkillDraft(e.target.value)}
                        placeholder="Add a skill, e.g. Kubernetes"
                        aria-label="Add a required skill"
                      />
                      <Button type="submit" variant="subtle" leftIcon={<Plus aria-hidden />}>
                        Add
                      </Button>
                    </form>
                  </div>

                  {/* Nice-to-have chips */}
                  {job.niceToHaveSkills.length > 0 && (
                    <div>
                      <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
                        Nice to have
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {job.niceToHaveSkills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] py-1 pl-3 pr-1.5 text-xs font-medium text-ink-soft ring-1 ring-inset ring-ink/10"
                          >
                            {skill}
                            <button
                              type="button"
                              onClick={() => removeNiceToHave(skill)}
                              aria-label={`Remove ${skill}`}
                              className="grid h-4 w-4 place-items-center rounded-full text-muted transition hover:bg-ink/10 hover:text-ink"
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Validation warnings — live, recomputed from the editable brief above */}
              {liveValidationWarnings.length > 0 && (
                <Card>
                  <CardHeader>
                    <Eyebrow>Validation</Eyebrow>
                    <CardTitle className="mt-1">
                      {liveValidationWarnings.length === 1
                        ? "1 thing to confirm"
                        : `${liveValidationWarnings.length} things to confirm`}
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="pt-0">
                    <ul className="flex flex-col gap-2">
                      {liveValidationWarnings.map((w, i) => {
                        const tone = SEVERITY_TONE[w.severity];
                        return (
                          <li
                            key={`${w.field}-${i}`}
                            className="flex items-start gap-3 rounded-2xl border border-line bg-canvas/40 p-3"
                          >
                            <Badge tone={tone} size="sm" className="mt-0.5 shrink-0 px-1.5">
                              {SEVERITY_ICON[w.severity]}
                            </Badge>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-ink">
                                {w.field}
                              </span>
                              <span className="block text-sm text-muted">{w.message}</span>
                            </span>
                            <Badge tone={tone} size="sm" className="shrink-0 uppercase">
                              {w.severity}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </CardBody>
                </Card>
              )}

              {/* Clarification draft */}
              {parsed.clarificationDraft && (
                <Card>
                  <CardHeader className="flex items-start justify-between gap-3">
                    <div>
                      <Eyebrow>Suggested reply</Eyebrow>
                      <CardTitle className="mt-1">Clarification draft</CardTitle>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      leftIcon={<Copy aria-hidden />}
                      onClick={copyClarification}
                    >
                      Copy
                    </Button>
                  </CardHeader>
                  <CardBody className="pt-0">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl bg-canvas/70 p-4 font-sans text-sm leading-relaxed text-ink-soft ring-1 ring-inset ring-line">
                      {parsed.clarificationDraft}
                    </pre>
                  </CardBody>
                </Card>
              )}

              {/* Dust agent enrichment — optional, additive, never blocks the heuristic result above */}
              {(parsed.dustAnalysis || dustPending) && (
                <Card>
                  <CardHeader className="flex items-start justify-between gap-3">
                    <div>
                      <Eyebrow>Agent enrichment</Eyebrow>
                      <CardTitle className="mt-1">Dust analysis</CardTitle>
                    </div>
                    {dustPending && (
                      <Badge tone="electric" dot>
                        Analyzing…
                      </Badge>
                    )}
                  </CardHeader>
                  <CardBody className="pt-0">
                    {parsed.dustAnalysis ? (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl bg-canvas/70 p-4 font-sans text-sm leading-relaxed text-ink-soft ring-1 ring-inset ring-line">
                        {parsed.dustAnalysis.text}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted">Waiting on the locked Dust agent…</p>
                    )}
                  </CardBody>
                </Card>
              )}

              {/* Parsed JSON */}
              <Card>
                <CardHeader>
                  <Eyebrow className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    Parsed payload
                  </Eyebrow>
                  <CardTitle className="mt-1">Structured JSON</CardTitle>
                </CardHeader>
                <CardBody className="pt-0">
                  <pre className="max-h-80 overflow-auto rounded-2xl bg-ink/[0.04] p-4 font-mono text-xs leading-relaxed text-ink-soft ring-1 ring-inset ring-line">
                    {JSON.stringify(job, null, 2)}
                  </pre>
                </CardBody>
              </Card>

              {/* Create */}
              <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <Sparkles className="h-4 w-4 text-electric" aria-hidden />
                  Creates the campaign, builds the sourcing strategy, and opens its workspace.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  leftIcon={<Rocket aria-hidden />}
                  onClick={handleCreateCampaign}
                  className="shrink-0"
                >
                  Create campaign
                </Button>
              </div>
            </div>
          )}
        </div>
      </HydrationGate>
    </div>
  );
}

function IntakeFallback() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-hidden>
      <div className="card-surface space-y-4 p-6">
        <div className="skeleton h-4 w-1/3 rounded-xl" />
        <div className="skeleton h-48 w-full rounded-2xl" />
        <div className="skeleton h-36 w-full rounded-2xl" />
        <div className="skeleton h-11 w-1/2 rounded-full" />
      </div>
      <div className="card-surface space-y-4 p-6">
        <div className="skeleton h-4 w-1/3 rounded-xl" />
        <div className="skeleton h-11 w-full rounded-2xl" />
        <div className="skeleton h-11 w-full rounded-2xl" />
        <div className="skeleton h-11 w-full rounded-2xl" />
        <div className="skeleton h-40 w-full rounded-2xl" />
      </div>
    </div>
  );
}
