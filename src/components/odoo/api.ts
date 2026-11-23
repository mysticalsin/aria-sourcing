/* Tiny JSON client for the /api/integrations/odoo/* routes, and the shapes
   they return. The routes own authority; nothing here is trusted server-side. */

import type { CandidateStage } from "@/lib/types";

export type OdooApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

export async function odooApi<T>(path: string, init?: RequestInit): Promise<OdooApiResult<T>> {
  try {
    const res = await fetch(`/api/integrations/odoo${path}`, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error: String(json.error ?? `HTTP ${res.status}`),
        code: typeof json.code === "string" ? json.code : undefined,
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "ARIA is not reachable." };
  }
}

export const jsonBody = (method: "POST" | "PUT" | "DELETE", body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export type StageTarget = CandidateStage | "ignore";

export interface OdooConnectionView {
  configured: boolean;
  baseUrl?: string;
  publicUrl?: string;
  database?: string;
  keyLast4?: string;
  version?: string | null;
  userName?: string | null;
  stageMap?: Record<string, StageTarget>;
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

export interface OdooStageView {
  id: number;
  name: string;
  sequence: number;
  hiredStage: boolean;
  target: StageTarget;
  defaultTarget: StageTarget;
}

export interface OdooJobSummary {
  id: number;
  name: string;
  department: string;
  openings: number | null;
  applicationCount: number | null;
  url: string;
}

export interface OdooJobLink {
  campaignId: string;
  jobId: number;
  jobName: string | null;
  url: string | null;
}

export interface OdooApplicantView {
  candidateId: string;
  campaignId: string;
  applicantId: number;
  url: string;
  stage: string | null;
  status: "ongoing" | "hired" | "refused" | "archived" | "deleted";
  refuseReason: string | null;
  ariaStage: CandidateStage | null;
}

export const STATUS_LABEL: Record<OdooApplicantView["status"], string> = {
  ongoing: "In progress",
  hired: "Hired",
  refused: "Refused",
  archived: "Archived",
  deleted: "Deleted in Odoo",
};
