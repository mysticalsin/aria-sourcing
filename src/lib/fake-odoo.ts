/**
 * In-repo fake Odoo JSON-RPC. It accepts the hr.job fields present on Odoo 16,
 * 18, and 19, and rejects anything else — including `state`, which Odoo 16 removed.
 * Nothing here opens a socket.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** hr.job fields present on Odoo 16, 18, and 19. `state` was removed in Odoo 16. */
const HR_JOB_FIELDS = new Set([
  "active",
  "company_id",
  "contract_type_id",
  "department_id",
  "description",
  "employee_ids",
  "expected_employees",
  "name",
  "no_of_employee",
  "no_of_recruitment",
  "requirements",
  "sequence",
]);

export interface OdooRpcBody {
  params?: { method?: string; args?: unknown[] };
}

function unknownHrJobField(body: OdooRpcBody): string | null {
  if (body.params?.method !== "execute_kw" || body.params.args?.[3] !== "hr.job") return null;
  const positional = body.params.args[5];
  if (!Array.isArray(positional)) return null;
  const method = body.params.args[4];
  const vals =
    method === "create"
      ? Array.isArray(positional[0])
        ? positional[0][0]
        : undefined
      : method === "write"
        ? positional[1]
        : undefined;
  if (!vals || typeof vals !== "object" || Array.isArray(vals)) return null;
  for (const field of Object.keys(vals)) {
    if (!HR_JOB_FIELDS.has(field)) return field;
  }
  return null;
}

export function odooExecuteResponse(body: OdooRpcBody, nextId: () => number): Response {
  if (body.params?.method === "authenticate") return jsonResponse(200, { result: 7 });
  const kw = body.params?.args?.[6];
  if (kw && typeof kw === "object" && !Array.isArray(kw) && Object.keys(kw).length > 0) {
    return jsonResponse(200, { error: { message: "TypeError: unexpected keyword argument" } });
  }
  const field = unknownHrJobField(body);
  if (field) {
    return jsonResponse(200, { error: { message: `ValueError: Invalid field '${field}' on model 'hr.job'` } });
  }
  return jsonResponse(200, { result: nextId() });
}

export interface RecordedOdooCall {
  url: string;
  init?: RequestInit;
}

/** Fetch stand-in that records every call and answers with the fake Odoo. */
export function createFakeOdooFetch(startId = 10): { calls: RecordedOdooCall[]; fetch: typeof fetch } {
  const calls: RecordedOdooCall[] = [];
  let nextId = startId;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const body = JSON.parse(String(init?.body ?? "{}")) as OdooRpcBody;
    return odooExecuteResponse(body, () => {
      nextId += 1;
      return nextId;
    });
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}
