// The only LinkedIn requests this extension will ever execute.
//
// ARIA builds each request; the extension checks it against this list before
// running it in the user's LinkedIn tab. A leaked pairing token therefore
// cannot turn the extension into a general-purpose LinkedIn proxy: it can read
// the inbox, look up a profile by its public id and send a message, nothing
// else. tests/linkedin-bridge.mts checks that every request ARIA builds passes.

export const LINKEDIN_ORIGIN = "https://www.linkedin.com";

const RULES = [
  { method: "GET", path: "/voyager/api/me", query: null },
  {
    method: "GET",
    path: "/voyager/api/voyagerMessagingGraphQL/graphql",
    query: /^queryId=messenger(?:Conversations|Messages)\.[0-9a-f]{32}&variables=\([^&]*\)$/,
  },
  {
    method: "POST",
    path: "/voyager/api/voyagerMessagingDashMessengerMessages",
    query: /^action=createMessage$/,
  },
  {
    method: "GET",
    path: "/voyager/api/identity/dash/profiles",
    query: /^q=memberIdentity&memberIdentity=[A-Za-z0-9%_.-]{1,200}$/,
  },
];

const ALLOWED_HEADERS = new Set(["accept", "content-type", "x-restli-protocol-version"]);
export const MAX_REQUEST_BODY_CHARS = 20000;

/**
 * Returns null when the request is allowed, otherwise the reason it is not.
 * @param {any} spec  untrusted: whatever ARIA sent
 * @returns {string | null}
 */
export function checkLinkedInRequest(spec) {
  if (!spec || typeof spec !== "object") return "invalid request";
  const { method, path, headers, body } = spec;
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("#")) return "invalid path";
  const queryStart = path.indexOf("?");
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
  const query = queryStart === -1 ? "" : path.slice(queryStart + 1);
  const rule = RULES.find((candidate) => candidate.method === method && candidate.path === pathname);
  if (!rule) return `request not allowed: ${String(method)} ${pathname}`;
  if (rule.query ? !rule.query.test(query) : query !== "") return "query not allowed";
  if (headers !== undefined && headers !== null) {
    if (typeof headers !== "object" || Array.isArray(headers)) return "invalid headers";
    for (const [name, value] of Object.entries(headers)) {
      if (!ALLOWED_HEADERS.has(name.toLowerCase()) || typeof value !== "string") return `header not allowed: ${name}`;
    }
  }
  if (method === "GET" && body !== undefined && body !== null) return "GET request with a body";
  if (method === "POST" && typeof body !== "string") return "POST request without a body";
  if (typeof body === "string" && body.length > MAX_REQUEST_BODY_CHARS) return "body too large";
  return null;
}
