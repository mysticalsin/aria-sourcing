// Same tokens as the Go hand-off adapter. Anything else, including empty, is off.
export function interviewerHandoffEnabled(
  raw: string | undefined = process.env.ARIA_INTERVIEWER_ENABLED,
): boolean {
  return raw === "true" || raw === "TRUE" || raw === "True" || raw === "1";
}
