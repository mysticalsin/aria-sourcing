import { DEDUPE_WINDOW_DAYS, daysSince } from "./rules";
import type { Candidate } from "./types";

export type ContactStatus =
  | "never"
  | "contacted"
  | "in_window"
  | "do_not_contact"
  | "suppressed";

export interface ContactStatusInfo {
  status: ContactStatus;
  label: string;
  /** True when sourcing / first-touch outreach should skip this identity. */
  blockResourcing: boolean;
  lastContactedAt: string | null;
  daysSinceContact: number | null;
}

/** Derive contact tracking state for UI + sourcing filters. */
export function getContactStatus(
  candidate: Pick<Candidate, "lastContactedAt" | "complianceFlags" | "stage" | "recontactAt">,
  nowMs: number = Date.now(),
): ContactStatusInfo {
  const flags = candidate.complianceFlags;
  if (flags?.doNotContact) {
    return {
      status: "do_not_contact",
      label: "Do not contact",
      blockResourcing: true,
      lastContactedAt: candidate.lastContactedAt,
      daysSinceContact: candidate.lastContactedAt ? daysSince(candidate.lastContactedAt, nowMs) : null,
    };
  }
  if (flags?.suppressed || flags?.unsubscribed) {
    return {
      status: "suppressed",
      label: flags.unsubscribed ? "Unsubscribed" : "Suppressed",
      blockResourcing: true,
      lastContactedAt: candidate.lastContactedAt,
      daysSinceContact: candidate.lastContactedAt ? daysSince(candidate.lastContactedAt, nowMs) : null,
    };
  }
  if (candidate.recontactAt) {
    const until = new Date(candidate.recontactAt).getTime();
    if (Number.isFinite(until) && until > nowMs) {
      return {
        status: "in_window",
        label: "Recontact hold",
        blockResourcing: true,
        lastContactedAt: candidate.lastContactedAt,
        daysSinceContact: candidate.lastContactedAt ? daysSince(candidate.lastContactedAt, nowMs) : null,
      };
    }
  }
  if (candidate.lastContactedAt) {
    const days = daysSince(candidate.lastContactedAt, nowMs);
    if (days < DEDUPE_WINDOW_DAYS) {
      return {
        status: "in_window",
        label: `Contacted ${Math.round(days)}d ago`,
        blockResourcing: true,
        lastContactedAt: candidate.lastContactedAt,
        daysSinceContact: days,
      };
    }
    return {
      status: "contacted",
      label: `Contacted ${Math.round(days)}d ago`,
      blockResourcing: false,
      lastContactedAt: candidate.lastContactedAt,
      daysSinceContact: days,
    };
  }
  if (candidate.stage === "Contacted" || candidate.stage === "Not Interested") {
    return {
      status: "contacted",
      label: candidate.stage === "Not Interested" ? "Not interested" : "Contacted",
      blockResourcing: candidate.stage === "Not Interested",
      lastContactedAt: null,
      daysSinceContact: null,
    };
  }
  return {
    status: "never",
    label: "Not contacted",
    blockResourcing: false,
    lastContactedAt: null,
    daysSinceContact: null,
  };
}

/** True when an existing pool identity should not be re-sourced / re-contacted. */
export function shouldSkipResourcing(
  existing: Pick<Candidate, "lastContactedAt" | "complianceFlags" | "stage" | "recontactAt">,
  nowMs: number = Date.now(),
): boolean {
  return getContactStatus(existing, nowMs).blockResourcing;
}
