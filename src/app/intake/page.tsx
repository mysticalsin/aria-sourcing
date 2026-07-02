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
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import {
  parseEmailAndJD,
  SAMPLE_INTAKE_EMAIL,
  SAMPLE_INTAKE_JD,
  SAMPLE_MANTU_EMAIL,
  type ParsedIntake,
} from "@/lib/mock-ai";
import { useActions, useHydrated, useSettings } from "@/lib/store";
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

const LOCATION_TYPES = ["Remote", "Hybrid", "On-site"] as const;

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
  const actions = useActions();
  const settings = useSettings();

  const [email, setEmail] = useState("");
  const [jd, setJd] = useState("");
  const [parsed, setParsed] = useState<ParsedIntake | null>(null);
  const [job, setJob] = useState<JobAnalysis | null>(null);
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [skillDraft, setSkillDraft] = useState("");
  const [dustPending, setDustPending] = useState(false);
  // Guards against a slow Dust reply from an earlier parse landing on top of a
  // newer one if the user re-parses before the first call resolves.
  const parseSeqRef = React.useRef(0);

  function patchJob(patch: Partial<JobAnalysis>) {
    setJob((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  /** Enrichment on top of the heuristic parse above — never blocks or replaces it.
   *  Only fires when a "jdAnalysis" Dust agent is locked in Settings; any failure
   *  (unconfigured, network, Dust error) just leaves `dustAnalysis` unset. */
  function maybeRunDustJdAnalysis(rawJd: string, rawEmail: string) {
    const seq = ++parseSeqRef.current;
    setDustPending(false);
    const agentSId = settings.dust?.connected ? settings.dust.agentLocks?.jdAnalysis : undefined;
    if (!agentSId) return;
    const message = rawJd.trim() || rawEmail;
    if (!message.trim()) return;
    setDustPending(true);
    void actions.runDustTask("jdAnalysis", message).then((res) => {
      if (parseSeqRef.current !== seq) return; // superseded by a newer parse
      setDustPending(false);
      if (res.ok && res.text) {
        const text = res.text;
        setParsed((prev) => (prev ? { ...prev, dustAnalysis: { agentId: agentSId, text } } : prev));
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

  /** Simulates an inbound email arriving and being auto-scanned (the /api/intake flow). */
  function scanInbox() {
    const incoming = SAMPLE_MANTU_EMAIL;
    setEmail(incoming);
    setJd("");
    const result = parseEmailAndJD({ email: incoming });
    setParsed(result);
    setJob(result.jobAnalysis);
    setSenderName(result.sender.name);
    setSenderEmail(result.sender.email);
    maybeRunDustJdAnalysis("", incoming);
    toast({
      title: "Inbound need scanned",
      description: `${result.jobAnalysis.title} detected and parsed from the inbox.`,
      variant: "success",
    });
  }

  function handleParse() {
    if (!email.trim()) {
      toast({
        title: "Nothing to parse",
        description: "Paste the recruiter email or brief first.",
        variant: "warning",
      });
      return;
    }
    const result = parseEmailAndJD({ email, jd: jd.trim() ? jd : undefined });
    setParsed(result);
    setJob(result.jobAnalysis);
    setSenderName(result.sender.name);
    setSenderEmail(result.sender.email);
    maybeRunDustJdAnalysis(jd, email);
    toast({
      title: "Brief parsed",
      description: `${result.jobAnalysis.title} · ${result.jobAnalysis.requiredSkills.length} required skills detected.`,
      variant: "success",
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

  function handleCreateCampaign() {
    if (!job) return;
    const campaign = actions.createCampaignFromAnalysis(job, {
      hiringManager: senderName.trim() || "Hiring Manager",
      hiringManagerEmail: senderEmail.trim() || "unknown@company.example",
    });
    toast({
      title: "Campaign created",
      description: `${campaign.title} is live. Sourcing strategy generated.`,
      variant: "success",
    });
    router.push(`/campaigns/${campaign.id}`);
  }

  function numberOrNull(raw: string): number | null {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Email + JD intake"
        description="Paste a hiring request and Aria parses it into a structured, editable brief, then spins up an autonomous sourcing campaign."
        actions={
          <Badge tone="aqua" dot>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Dry-run · nothing sent
          </Badge>
        }
      />

      <HydrationGate hydrated={hydrated} fallback={<IntakeFallback />}>
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
                  >
                    Sample backend role
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    leftIcon={<FileText aria-hidden />}
                    onClick={loadMantu}
                  >
                    Load Mantu need
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    size="sm"
                    leftIcon={<Inbox aria-hidden />}
                    onClick={scanInbox}
                  >
                    Scan inbox
                  </Button>
                  <Button
                    type="button"
                    leftIcon={<ScanText aria-hidden />}
                    onClick={handleParse}
                    disabled={!email.trim()}
                    className="ml-auto"
                  >
                    Parse JD
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

                  {/* Seniority + urgency */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Seniority" htmlFor="job-seniority">
                      <Select
                        id="job-seniority"
                        value={job.seniority}
                        onChange={(e) => patchJob({ seniority: e.target.value as Seniority })}
                        options={SENIORITY_LEVELS.map((s) => ({ value: s, label: s }))}
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

              {/* Validation warnings */}
              {parsed.validationWarnings.length > 0 && (
                <Card>
                  <CardHeader>
                    <Eyebrow>Validation</Eyebrow>
                    <CardTitle className="mt-1">
                      {parsed.validationWarnings.length === 1
                        ? "1 thing to confirm"
                        : `${parsed.validationWarnings.length} things to confirm`}
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="pt-0">
                    <ul className="flex flex-col gap-2">
                      {parsed.validationWarnings.map((w, i) => {
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
