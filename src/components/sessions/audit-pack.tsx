import type { Candidate, Campaign } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { isRealSendFact } from "@/lib/metrics";
import type { ReplayStep, ReplayStepKind } from "@/components/sessions/replay-model";

/* ============================================================================
   Audit Pack — a plain, ink-on-paper, paginated trace of a candidate's
   Decision Replay chain, for export/print. Deliberately styled in flat
   black-on-white (not the app's theme tokens) since it only ever renders
   inside the print media query (see decision-replay.tsx's export flow).
   Pure presentational component: it renders whatever ReplayStep[] it's
   given, so it always matches exactly what the interactive replay showed.
   ========================================================================== */

const KIND_LABEL: Record<ReplayStepKind, string> = {
  sourced: "Sourced",
  scored: "Scored",
  drafted: "Drafted",
  approved: "Approved",
  sent: "Sent",
  rejected: "Rejected",
  replied: "Replied",
  booked: "Booked",
  compliance: "Compliance",
  note: "Note",
  other: "Event",
};

function StepEvidence({ step, candidate }: { step: ReplayStep; candidate: Candidate }) {
  switch (step.kind) {
    case "sourced":
      return (
        <div className="mt-2 text-xs text-black/70">
          {candidate.sourceQuery && <p>Query: {candidate.sourceQuery}</p>}
          {candidate.techStack.length > 0 && <p>Stack: {candidate.techStack.join(", ")}</p>}
        </div>
      );

    case "scored":
      return candidate.matchBreakdown.length > 0 ? (
        <table className="mt-2 w-full border-collapse text-xs">
          <tbody>
            {candidate.matchBreakdown.map((item) => (
              <tr key={item.key} className="border-t border-black/10">
                <td className="py-1 pr-2 font-semibold">{item.label}</td>
                <td className="py-1 pr-2 text-black/60">{Math.round(item.weight * 100)}% weight</td>
                <td className="py-1 pr-2 tabular-nums">{Math.round(item.score)}/100</td>
                <td className="py-1 text-black/60">{item.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null;

    case "drafted": {
      const evidence = step.message?.personalizationEvidence.filter((e) => e.trim().length > 0) ?? [];
      return (
        <div className="mt-2 text-xs text-black/70">
          {step.message && <p className="font-semibold text-black">{step.message.subject}</p>}
          {step.message && <p className="mt-1 whitespace-pre-wrap">{step.message.body}</p>}
          {evidence.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {evidence.map((e, i) => (
                <li key={i}>• {e}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    case "approved":
    case "sent":
    case "rejected":
      return step.message ? (
        <p className="mt-2 text-xs text-black/70">
          Status: {step.message.status} · Channel: {step.message.channel}
          {step.message.approvedBy ? ` · Approved by ${step.message.approvedBy}` : ""}
          {isRealSendFact(step.message)
            ? ` · Sent ${formatDateTime(step.message.sentAt!)}`
            : step.message.sentAt && step.message.dryRun === true
              ? ` · Dry-run stamp ${formatDateTime(step.message.sentAt)} — nothing contacted`
              : ""}
        </p>
      ) : null;

    case "replied":
      return step.reply ? (
        <div className="mt-2 text-xs text-black/70">
          <p>
            Intent: {step.reply.intent} · Confidence {Math.round(step.reply.confidence * 100)}%
          </p>
          <p className="mt-1 whitespace-pre-wrap">{step.reply.body}</p>
        </div>
      ) : null;

    case "booked":
      return step.booking ? (
        <p className="mt-2 text-xs text-black/70">
          {step.booking.interviewer} · {formatDateTime(step.booking.startTime)} ({step.booking.timezone}) ·{" "}
          {step.booking.status}
        </p>
      ) : step.interview ? (
        <p className="mt-2 text-xs text-black/70">
          {step.interview.kind} · {step.interview.interviewer} · {step.interview.outcome}
        </p>
      ) : null;

    default:
      return null;
  }
}

export function AuditPack({
  candidate,
  campaign,
  steps,
}: {
  candidate: Candidate;
  campaign?: Campaign;
  steps: ReplayStep[];
}) {
  const generatedAt = new Date().toISOString();
  return (
    <div className="mx-auto max-w-[780px] bg-white px-10 py-12 text-black">
      <style>{`
        @page { margin: 16mm; }
        .audit-step { break-inside: avoid; page-break-inside: avoid; }
      `}</style>

      <header className="mb-8 border-b-2 border-black pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/60">
          Decision Replay: Audit Pack
        </p>
        <h1 className="mt-1 text-2xl font-bold">{candidate.name}</h1>
        <p className="mt-1 text-sm text-black/70">
          {candidate.currentTitle}
          {candidate.currentCompany ? ` at ${candidate.currentCompany}` : ""}
        </p>
        {campaign && (
          <p className="mt-1 text-sm text-black/70">
            Role: {campaign.title} ({campaign.department}) · Hiring manager: {campaign.hiringManager}
          </p>
        )}
        <p className="mt-3 text-xs text-black/50">
          {steps.length} step{steps.length === 1 ? "" : "s"} · generated {formatDateTime(generatedAt)}
        </p>
      </header>

      <ol className="space-y-5">
        {steps.map((step, i) => (
          <li key={step.key} className="audit-step border border-black/20 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-bold uppercase tracking-wide">
                {i + 1}.{" "}
                {step.kind === "sent" && step.message && !isRealSendFact(step.message)
                  ? step.message.dryRun
                    ? "Approved (dry-run)"
                    : "Queued"
                  : KIND_LABEL[step.kind]}
                {step.synthesized && <span className="ml-2 font-normal italic text-black/50">(synthesized)</span>}
              </p>
              <p className="shrink-0 text-xs text-black/60">{formatDateTime(step.at)}</p>
            </div>
            <p className="mt-1 text-sm font-semibold">{step.title}</p>
            <p className="mt-1 text-xs text-black/70">
              Signed: <span className="font-semibold">{step.who}</span>
            </p>
            {step.outcome && <p className="mt-2 text-xs text-black/80">Outcome: {step.outcome}</p>}
            {step.notes && <p className="mt-1 text-xs text-black/70">{step.notes}</p>}
            <StepEvidence step={step} candidate={candidate} />
          </li>
        ))}
      </ol>

      <footer className="mt-10 border-t border-black/20 pt-3 text-[0.65rem] text-black/50">
        MSourcing / Aria: Decision Replay audit export. Read-only trace; no send or mutation actions were taken to
        produce this document.
      </footer>
    </div>
  );
}
