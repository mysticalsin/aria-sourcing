/* What a LinkedIn answer relayed by the extension means for the bridge. */

export type LinkedInAnswer =
  | { kind: "ok"; json: unknown }
  /** LinkedIn rejected the session: the user must sign in again. */
  | { kind: "session"; status: number; detail: string }
  /** LinkedIn asked to slow down. */
  | { kind: "throttled"; status: number; detail: string }
  /** LinkedIn wants a security check (checkpoint, login wall, HTML page). */
  | { kind: "challenge"; status: number; detail: string }
  /** The extension could not reach LinkedIn at all. */
  | { kind: "transport"; detail: string }
  /** Any other HTTP error, with LinkedIn's own message when it gave one. */
  | { kind: "error"; status: number; detail: string };

export interface RelayedAnswer {
  status: number;
  body: string;
  error?: string | null;
  finalUrl?: string | null;
}

function linkedInMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const message = parsed.message ?? (parsed.data as Record<string, unknown> | undefined)?.message;
    return typeof message === "string" && message.trim() ? message.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

export function classifyAnswer(answer: RelayedAnswer): LinkedInAnswer {
  const { status, body } = answer;
  if (answer.error || status === 0) {
    return { kind: "transport", detail: (answer.error ?? "LinkedIn could not be reached.").slice(0, 200) };
  }
  if (answer.finalUrl && /linkedin\.com\/(?:checkpoint|authwall|login|uas\/login)/i.test(answer.finalUrl)) {
    return {
      kind: "challenge",
      status,
      detail: "LinkedIn wants you to sign in or pass a security check. Open linkedin.com in this browser.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      kind: "session",
      status,
      detail: `LinkedIn refused the session (HTTP ${status}). Open linkedin.com in this browser and sign in again.`,
    };
  }
  if (status === 429 || status === 999) {
    return { kind: "throttled", status, detail: `LinkedIn asked to slow down (HTTP ${status}). The bridge pauses for a while.` };
  }
  if (status < 200 || status >= 300) {
    const message = linkedInMessage(body);
    return { kind: "error", status, detail: message ? `LinkedIn: ${message}` : `LinkedIn answered HTTP ${status}.` };
  }
  try {
    return { kind: "ok", json: JSON.parse(body) };
  } catch {
    if (/^\s*</.test(body)) {
      return {
        kind: "challenge",
        status,
        detail: "LinkedIn answered with a web page instead of data, usually a security check. Open linkedin.com in this browser.",
      };
    }
    return { kind: "error", status, detail: "LinkedIn's answer could not be read." };
  }
}

/** GraphQL errors arrive with HTTP 200 and an `errors` array. */
export function graphqlErrors(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const errors = (json as Record<string, unknown>).errors;
  if (!Array.isArray(errors) || !errors.length) return null;
  const first = errors[0] as Record<string, unknown> | undefined;
  const message = typeof first?.message === "string" ? first.message : "GraphQL error";
  return message.slice(0, 200);
}
