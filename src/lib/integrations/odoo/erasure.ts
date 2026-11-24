/* ============================================================================
   The Odoo side of an ARIA candidate erasure (ADR 0003, docs/odoo.md).
   Called by /api/admin/candidates/erasure after ARIA's own erasure, and by
   the retry in Settings > Odoo. odoo_erasures is the receipt.
   ========================================================================== */

import { isOdooError } from "./client";
import { eraseApplicant } from "./service";
import {
  applicantLinkFor,
  clientForConnection,
  deleteApplicantLink,
  odooErasureFor,
  readConnection,
  saveOdooErasure,
  type OdooErasureRow,
  type Svc,
} from "./authority";

export interface OdooErasureResult {
  status: OdooErasureRow["status"];
  applicantId: number;
  detail: string;
}

/**
 * The Odoo side of an ARIA candidate erasure. Null when the candidate never
 * reached Odoo. The link is forgotten at once (the erasure row keeps the
 * applicant id as the receipt); Odoo unreachable leaves the erasure pending,
 * for a retry from Settings > Odoo.
 */
export async function eraseFromOdoo(
  svc: Svc,
  workspaceId: string,
  candidateId: string,
  requestId: string | null,
): Promise<OdooErasureResult | null> {
  const [link, previous] = await Promise.all([applicantLinkFor(svc, workspaceId, candidateId), odooErasureFor(svc, workspaceId, candidateId)]);
  if (previous && (previous.status === "deleted" || previous.status === "kept_hired")) {
    return { status: previous.status, applicantId: previous.applicant_id, detail: previous.detail ?? "" };
  }
  const applicantId = link?.applicant_id ?? previous?.applicant_id ?? null;
  if (link) await deleteApplicantLink(svc, workspaceId, candidateId);
  if (!applicantId) return null;
  const attempts = Math.min((previous?.attempts ?? 0) + 1, 100);
  const base = { candidate_id: candidateId, request_id: requestId ?? previous?.request_id ?? null, applicant_id: applicantId, attempts };
  const save = async (status: OdooErasureRow["status"], detail: string): Promise<OdooErasureResult> => {
    await saveOdooErasure(svc, workspaceId, { ...base, status, detail });
    return { status, applicantId, detail };
  };

  const connection = await readConnection(svc, workspaceId);
  if (!connection) return save("pending", "Odoo is not connected: reconnect it in Settings > Odoo, then retry this erasure.");
  const resolved = clientForConnection(connection);
  if (!resolved.ok) return save("pending", "The stored Odoo API key cannot be read: enter it again in Settings > Odoo, then retry.");
  try {
    const erased = await eraseApplicant(resolved.client, applicantId, `ARIA erasure ${requestId ?? candidateId}`);
    if (erased.outcome === "kept_hired") return save("kept_hired", erased.detail);
    return save("deleted", `${erased.detail}${erased.logged ? " Recorded in Odoo's privacy log." : ""}`);
  } catch (error) {
    if (isOdooError(error) && (error.code === "unreachable" || error.code === "timeout" || error.code === "server_error")) {
      return save("pending", `Odoo did not answer (${error.message}). Retry from Settings > Odoo.`);
    }
    return save("failed", isOdooError(error) ? `Odoo refused: ${error.message}` : "The Odoo erasure failed.");
  }
}
