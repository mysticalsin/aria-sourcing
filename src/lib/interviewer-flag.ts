// Same tokens as the Go hand-off adapter. Anything else, including empty, is off.
export function interviewerHandoffEnabled(): boolean {
  const raw = process.env.ARIA_INTERVIEWER_ENABLED ?? "";
  return raw === "true" || raw === "TRUE" || raw === "True" || raw === "1";
}
