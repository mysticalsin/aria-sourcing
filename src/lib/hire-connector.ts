import { fetchPublicUrl } from "@/lib/api/public-fetch";
import { classifyFetchHost } from "@/lib/api/url";
import { redactSecrets } from "@/lib/log-redact";

export type HireConnectorKind = "odoo" | "smart" | "linkedin";

export type HireResult = { ok: true; id: string } | { ok: false; error: string };

export type HireCall = {
  idempotencyKey: string;
  model: string;
  method: "create" | "write" | "search";
  values: Record<string, unknown>;
};

export interface HireConnector {
  kind: HireConnectorKind;
  call(input: HireCall): Promise<HireResult>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const HIRE_MODELS = new Set(["hr.job", "hr.applicant"]);

function missing(kind: HireConnectorKind, name: string): HireResult {
  return { ok: false, error: `${kind} missing ${name}` };
}

/**
 * ERP base URLs come from the environment and receive credentials, so they
 * must be public HTTPS hosts with no embedded login. The default transport
 * also pins DNS to a public address and never follows redirects.
 */
function erpBase(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (classifyFetchHost(url.hostname.replace(/^\[|\]$/g, "")) === "blocked") return null;
  return url.toString().replace(/\/+$/, "");
}

function scrubbed(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return redactSecrets(out).slice(0, 200);
}

function odooRecordId(result: unknown, input: HireCall): string | null {
  if (result === true) return String(input.values.id ?? input.idempotencyKey);
  if (typeof result === "number" && Number.isSafeInteger(result) && result > 0) return String(result);
  if (Array.isArray(result) && typeof result[0] === "number" && result[0] > 0) return String(result[0]);
  return null;
}

export function odooHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetchPublicUrl): HireConnector {
  return {
    kind: "odoo",
    async call(input) {
      const url = env.ODOO_URL;
      const db = env.ODOO_DB;
      const user = env.ODOO_USERNAME;
      const key = env.ODOO_API_KEY;
      if (!url || !db || !user || !key) return missing("odoo", "ODOO_URL, ODOO_DB, ODOO_USERNAME, or ODOO_API_KEY");
      const base = erpBase(url);
      if (!base) return { ok: false, error: "odoo ODOO_URL must be a public https URL without credentials" };
      const endpoint = `${base}/jsonrpc`;
      const authRes = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          id: input.idempotencyKey,
          params: { service: "common", method: "authenticate", args: [db, user, key, {}] },
        }),
      });
      if (!authRes.ok) return { ok: false, error: `odoo auth http ${authRes.status}` };
      const authBody = (await authRes.json()) as { result?: unknown; error?: { message?: string } };
      const uid = authBody.result;
      if (typeof uid !== "number" || !Number.isSafeInteger(uid) || uid <= 0) {
        return { ok: false, error: scrubbed(authBody.error?.message ?? "odoo auth failed", [key, user]) };
      }
      const writeRes = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          id: input.idempotencyKey,
          params: {
            service: "object",
            method: "execute_kw",
            args: [db, uid, key, input.model, input.method, [], { ...input.values, x_idempotency_key: input.idempotencyKey }],
          },
        }),
      });
      if (!writeRes.ok) return { ok: false, error: `odoo write http ${writeRes.status}` };
      const writeBody = (await writeRes.json()) as { result?: unknown; error?: { message?: string } };
      if (writeBody.error) return { ok: false, error: scrubbed(writeBody.error.message ?? "odoo execute_kw failed", [key, user]) };
      const id = odooRecordId(writeBody.result, input);
      if (!id) return { ok: false, error: "odoo execute_kw returned no record" };
      return { ok: true, id };
    },
  };
}

export function smartHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetchPublicUrl): HireConnector {
  return {
    kind: "smart",
    async call(input) {
      const raw = env.SMART_URL;
      const token = env.SMART_TOKEN;
      if (!raw || !token) return missing("smart", "SMART_URL or SMART_TOKEN");
      const base = erpBase(raw);
      if (!base) return { ok: false, error: "smart SMART_URL must be a public https URL without credentials" };
      if (!HIRE_MODELS.has(input.model)) return { ok: false, error: "smart model must be hr.job or hr.applicant" };
      const res = await fetchImpl(`${base}/api/hire/${encodeURIComponent(input.model)}`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ method: input.method, values: input.values }),
      });
      if (!res.ok) return { ok: false, error: `smart http ${res.status}` };
      const body = (await res.json()) as { id?: unknown; error?: unknown };
      if (body.error) return { ok: false, error: scrubbed(String(body.error), [token]) };
      if (typeof body.id !== "string" || !body.id) return { ok: false, error: "smart response missing id" };
      return { ok: true, id: body.id };
    },
  };
}

/** LinkedIn sourcing does not depend on Odoo or SMART. Callers gate ERP sync separately. */
export function linkedInSourcingRunsWithoutErp(_env: NodeJS.ProcessEnv): boolean {
  return true;
}
