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

type FetchLike = typeof fetch;

function missing(kind: HireConnectorKind, name: string): HireResult {
  return { ok: false, error: `${kind} missing ${name}` };
}

export function odooHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch): HireConnector {
  return {
    kind: "odoo",
    async call(input) {
      const url = env.ODOO_URL;
      const db = env.ODOO_DB;
      const user = env.ODOO_USERNAME;
      const key = env.ODOO_API_KEY;
      if (!url || !db || !user || !key) return missing("odoo", "ODOO_URL, ODOO_DB, ODOO_USERNAME, or ODOO_API_KEY");
      const endpoint = `${url.replace(/\/$/, "")}/jsonrpc`;
      const authRes = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          id: input.idempotencyKey,
          params: { service: "common", method: "authenticate", args: [db, user, key, {}] },
        }),
      });
      if (!authRes.ok) return { ok: false, error: `odoo auth http ${authRes.status}` };
      const authBody = (await authRes.json()) as { result?: number; error?: { message?: string } };
      if (!authBody.result) return { ok: false, error: authBody.error?.message ?? "odoo auth failed" };
      const uid = authBody.result;
      const writeRes = await fetchImpl(endpoint, {
        method: "POST",
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
      const writeBody = (await writeRes.json()) as { result?: number | number[]; error?: { message?: string } };
      if (writeBody.error) return { ok: false, error: writeBody.error.message ?? "odoo execute_kw failed" };
      const id = Array.isArray(writeBody.result) ? String(writeBody.result[0] ?? input.idempotencyKey) : String(writeBody.result ?? input.idempotencyKey);
      return { ok: true, id };
    },
  };
}

export function smartHireConnector(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch): HireConnector {
  return {
    kind: "smart",
    async call(input) {
      const base = env.SMART_URL;
      const token = env.SMART_TOKEN;
      if (!base || !token) return missing("smart", "SMART_URL or SMART_TOKEN");
      const res = await fetchImpl(`${base.replace(/\/$/, "")}/api/hire/${encodeURIComponent(input.model)}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ method: input.method, values: input.values }),
      });
      if (!res.ok) return { ok: false, error: `smart http ${res.status}` };
      const body = (await res.json()) as { id?: string; error?: string };
      if (body.error || !body.id) return { ok: false, error: body.error ?? "smart response missing id" };
      return { ok: true, id: body.id };
    },
  };
}

/** LinkedIn sourcing does not depend on Odoo or SMART. Callers gate ERP sync separately. */
export function linkedInSourcingRunsWithoutErp(_env: NodeJS.ProcessEnv): boolean {
  return true;
}
