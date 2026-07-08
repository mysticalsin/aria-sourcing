import * as React from "react";
import { UserCheck, ShieldCheck } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Eyebrow,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from "@/components/ui";
import { StageBadge, SourceBadge } from "@/components/tania/badges";
import { TANIA_STAGE_META } from "@/lib/tania";
import type { TaniaStage } from "@/lib/types";

/* ============================================================================
   TAnIA §7 — Stage × Source flow matrix (read-only).
   Encodes how each agent acts by lead source at every funnel stage, and the
   human decision gate that never gets skipped ("Human Always Decides").
   Authored from the TAnIA model — reuses the Mantu tokens + TAnIA badges so it
   inherits the existing visual language (no new palette).
   ========================================================================== */

interface Gate {
  /** What the agent does at this stage for this source. */
  action: string;
  /** The human decision that must happen — the gate the agent can't skip. */
  gate: string;
}

interface FlowRow {
  stage: TaniaStage;
  /** Sub-step label within the stage (screening / outreach / prequal, …). */
  phase: string;
  /** Set when the behaviour is identical across all three sources (spans them). */
  shared?: Gate;
  /** Per-source behaviour (used when `shared` is absent). null = not via source. */
  applicant?: Gate | null;
  referral?: Gate | null;
  outbound?: Gate | null;
  /** The overarching human-authority note for this row. */
  note: string;
}

const ROWS: FlowRow[] = [
  {
    stage: "Chatbox",
    phase: "Entry & scoring",
    applicant: {
      action:
        "Candidate fills the chatbox; the CV is analysed, up to 5 screening questions asked, a 0–100 score computed, then handed to the Applicant Screener.",
      gate: "Recruiter opens the scorecard and acts.",
    },
    referral: null,
    outbound: null,
    note: "Nothing auto-advances. A recruiter reads the scorecard first.",
  },
  {
    stage: "Need",
    phase: "Need brief & job ad",
    shared: {
      action: "Job Offer Creator drafts the need, the job ad and runs the Knight M check.",
      gate: "Recruiter approves before anything publishes.",
    },
    note: "No ad goes live without recruiter sign-off.",
  },
  {
    stage: "Leads",
    phase: "Screening & Star Rating",
    applicant: {
      action:
        "Applicant Screener parses the CV + answers and applies the Star Rating: TopGun/A instant, B to the digest, C/D to reject.",
      gate: "Prequal or reject.",
    },
    referral: {
      action:
        "Referral Evaluator scores the lead and flags the referrer. Always instant, never batched.",
      gate: "Reviews referrals first.",
    },
    outbound: {
      action:
        "Lead Agent + Lead Candidate Assessor build a ranked list; no contact is made without approval.",
      gate: "Approves the list and each contact.",
    },
    note: "No status change without the recruiter.",
  },
  {
    stage: "Leads",
    phase: "Outreach",
    applicant: {
      action: "Outreach Agent writes a responsive tone and queues the message as a batch.",
      gate: "1-tap batch approve.",
    },
    referral: {
      action:
        "Outreach Agent writes a warm, personal tone; handled individually, never batched.",
      gate: "Individual approve.",
    },
    outbound: {
      action: "Outreach Agent writes a proactive, opportunity-led tone; queued as a batch.",
      gate: "1-tap batch approve.",
    },
    note: "No message sends without human approval.",
  },
  {
    stage: "Leads",
    phase: "Prequal → CANDIDATE",
    shared: {
      action:
        "Prequal Call Prep pushes the scorecard T-5min; on advance the LEAD becomes a CANDIDATE.",
      gate: "1-tap Advance / Hold / Reject.",
    },
    note: "The promotion to CANDIDATE is a human call.",
  },
  {
    stage: "Candidates",
    phase: "Interviews: Intw1 / Intw2 (+ test) / Intw3 (+ QM)",
    shared: {
      action:
        "Scheduling with reminders at T-24h and T-1h; the hiring-manager feedback form is due T+30min.",
      gate: "Confirms the slot; the hiring manager fills the feedback.",
    },
    note: "A human confirms every slot; the HM owns feedback.",
  },
  {
    stage: "Offered",
    phase: "Offer & registration",
    shared: {
      action: "Offered Candidate Agent pre-fills the offer; SMART registration fires once it is signed.",
      gate: "HR and the manager approve.",
    },
    note: "HR + hiring manager sign the offer off.",
  },
  {
    stage: "Employees",
    phase: "Onboarding & talent pool",
    shared: {
      action:
        "OneStart Liaison runs pre-boarding; Time2Proficiency is tracked; Referral Champion invites the new hire to refer.",
      gate: "HR and the manager own it; TA checks in at 1 / 3 / 6 months.",
    },
    note: "People decisions stay with HR + manager.",
  },
];

function GateBody({ g }: { g: Gate }) {
  return (
    <>
      <p className="text-ink">{g.action}</p>
      <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-tangerine">
        <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Human: {g.gate}</span>
      </p>
    </>
  );
}

function SourceCell({ g }: { g: Gate | null | undefined }) {
  if (!g) {
    return (
      <TD className="align-top text-xs text-muted">
        <span aria-hidden>—</span>
        <span className="sr-only">Not applicable for this source</span>
      </TD>
    );
  }
  return (
    <TD className="align-top text-sm leading-relaxed">
      <GateBody g={g} />
    </TD>
  );
}

export function FlowMatrix() {
  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <Eyebrow>TAnIA §7 · Stage × Source</Eyebrow>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <CardTitle>Flow matrix</CardTitle>
          <Badge tone="tangerine" size="sm">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            Human Always Decides
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          How each agent acts by lead source at every stage, and the human decision gate that never
          gets skipped.
        </p>
      </CardHeader>
      <CardBody className="pt-0">
        <Table
          caption="TAnIA stage-by-source flow matrix with the human decision gate at every step"
          className="min-w-[64rem]"
        >
          <THead>
            <TR>
              <TH className="w-48">Stage</TH>
              <TH>
                <SourceBadge source="Applicant" size="sm" />
              </TH>
              <TH>
                <SourceBadge source="Referral" size="sm" />
              </TH>
              <TH>
                <SourceBadge source="Outbound" size="sm" />
              </TH>
              <TH className="w-56">Human always decides</TH>
            </TR>
          </THead>
          <TBody>
            {ROWS.map((row) => {
              const meta = TANIA_STAGE_META[row.stage];
              return (
                <TR key={`${row.stage}-${row.phase}`} className="align-top">
                  <TD className="align-top">
                    <StageBadge stage={row.stage} size="sm" />
                    <p className="mt-1.5 text-sm font-semibold text-ink">{row.phase}</p>
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                      {meta.sub}
                    </p>
                  </TD>

                  {row.shared ? (
                    <TD className="align-top text-sm leading-relaxed" colSpan={3}>
                      <span className="mb-2 inline-block rounded-full bg-ink/[0.05] px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-ink-soft">
                        All sources
                      </span>
                      <GateBody g={row.shared} />
                    </TD>
                  ) : (
                    <>
                      <SourceCell g={row.applicant} />
                      <SourceCell g={row.referral} />
                      <SourceCell g={row.outbound} />
                    </>
                  )}

                  <TD className="align-top">
                    <p className="flex items-start gap-1.5 text-xs font-semibold text-ink-soft">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tangerine" aria-hidden />
                      <span>{row.note}</span>
                    </p>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}
