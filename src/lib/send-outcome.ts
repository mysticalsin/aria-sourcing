/**
 * Honest send outcome chips — never look like success when nothing contacted.
 */

export type SendOutcomeKind =
  | "dry_run"
  | "sent"
  | "queued"
  | "authwall"
  | "refused_human_control"
  | "seat_cap"
  | "gap_wait"
  | "business_hours"
  | "session_unhealthy"
  | "error";

export type SendOutcome = {
  kind: SendOutcomeKind;
  title: string;
  detail: string;
  nextAction?: string;
};

export function classifySendOutcome(input: {
  dryRun?: boolean;
  status?: string;
  detail?: string;
  paceReason?: string;
}): SendOutcome {
  if (input.dryRun || input.status === "dry-run") {
    return {
      kind: "dry_run",
      title: "Dry-run",
      detail: input.detail || "Nothing contacted. Turn dry-run off for live sends.",
      nextAction: "Settings → Approval & Compliance → disable dry-run",
    };
  }

  const blob = `${input.status ?? ""} ${input.detail ?? ""} ${input.paceReason ?? ""}`.toLowerCase();

  if (input.paceReason === "min_gap" || blob.includes("min_gap") || blob.includes("human pacing")) {
    return {
      kind: "gap_wait",
      title: "Waiting (pace gap)",
      detail: input.detail || "Min gap between LinkedIn sends is enforced.",
      nextAction: "Wait for the next eligible time on the seat",
    };
  }
  if (
    input.paceReason === "business_hours" ||
    blob.includes("business_hours") ||
    blob.includes("send window")
  ) {
    return {
      kind: "business_hours",
      title: "Outside business hours",
      detail: input.detail || "Send deferred until the seat’s window.",
      nextAction: "Wait for the seat send window, or adjust it in Fleet",
    };
  }
  if (input.paceReason === "daily_cap" || blob.includes("daily cap")) {
    return {
      kind: "seat_cap",
      title: "Daily cap reached",
      detail: input.detail || "Seat hit today’s warmup/cap.",
      nextAction: "Try again tomorrow or attach another entitled seat",
    };
  }
  if (
    input.paceReason === "session_unhealthy" ||
    blob.includes("authwall") ||
    blob.includes("login") ||
    blob.includes("2fa") ||
    blob.includes("checkpoint") ||
    blob.includes("help_requested")
  ) {
    return {
      kind: "authwall",
      title: "LinkedIn login needed",
      detail: input.detail || "Session wall — human Take control required.",
      nextAction: "Campaign → Agents → Take control → log in → Release",
    };
  }
  if (blob.includes("human has control") || blob.includes("human mutex") || blob.includes("refused")) {
    return {
      kind: "refused_human_control",
      title: "Human still has control",
      detail: input.detail || "Release the computer so the bot can send.",
      nextAction: "Agents → Release",
    };
  }
  if (input.status === "sent") {
    return { kind: "sent", title: "Sent", detail: input.detail || "Delivered via automatic adapter." };
  }
  if (input.status === "queued") {
    return {
      kind: "queued",
      title: "Queued",
      detail: input.detail || "Queued on the Browser Computer.",
      nextAction: "Watch Agents for help_requested or success audit",
    };
  }
  return {
    kind: "error",
    title: "Send failed",
    detail: input.detail || input.status || "Unknown error",
    nextAction: "Check Agents audits and seat configuration",
  };
}
