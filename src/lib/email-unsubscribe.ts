import { createHash, randomBytes } from "crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface EmailUnsubscribeLink {
  token: string;
  tokenHash: string;
  url: string;
}

export interface RenderedUnsubscribeEmail {
  text: string;
  html: string;
  headers: {
    "List-Unsubscribe": string;
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click";
  };
}

/** An opaque, 256-bit recipient token. Only its SHA-256 digest is persisted. */
export function hashEmailUnsubscribeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isEmailUnsubscribeToken(token: string): boolean {
  return TOKEN_RE.test(token ?? "");
}

function canonicalUnsubscribeBaseUrl(): URL | null {
  const raw = process.env.OUTREACH_UNSUBSCRIBE_BASE_URL?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Creates the only public recipient identifier used in outreach email. Never
 * put a workspace, email address, or signed payload in this URL.
 */
export function createEmailUnsubscribeLink(): EmailUnsubscribeLink | null {
  const base = canonicalUnsubscribeBaseUrl();
  if (!base) return null;
  const token = randomBytes(32).toString("base64url");
  const basePath = base.pathname.replace(/\/+$/, "");
  base.pathname = `${basePath}/api/unsubscribe/${token}`;
  return { token, tokenHash: hashEmailUnsubscribeToken(token), url: base.toString() };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

function plainToHtml(body: string): string {
  return body
    .split("\n")
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<br/>"))
    .join("");
}

/**
 * Add a visible footer plus machine-readable one-click unsubscribe headers.
 * When `htmlBody` is provided (e.g. Mantu-branded wrapper), append the footer
 * into that document instead of rebuilding generic plain→HTML.
 */
export function renderEmailWithUnsubscribe(
  body: string,
  unsubscribeUrl: string,
  opts?: { htmlBody?: string },
): RenderedUnsubscribeEmail {
  const escapedUrl = escapeHtml(unsubscribeUrl);
  const footerHtml =
    `<hr/><p style="font-size:12px;color:#555">To stop receiving recruiting emails from us, <a href="${escapedUrl}">unsubscribe</a>.</p>`;
  let html: string;
  if (opts?.htmlBody?.trim()) {
    const branded = opts.htmlBody.trim();
    html = /<\/body>/i.test(branded)
      ? branded.replace(/<\/body>/i, `${footerHtml}</body>`)
      : `${branded}${footerHtml}`;
  } else {
    html = `${plainToHtml(body)}${footerHtml}`;
  }
  return {
    text: `${body}\n\nTo stop receiving recruiting emails from us, unsubscribe: ${unsubscribeUrl}`,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
