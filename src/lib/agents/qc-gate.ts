import { spawnSync } from "node:child_process";
import type { OutreachQcDraft, OutreachQcVerdict } from "./autopilot";

function envValue(name: string, env?: { [key: string]: string | undefined }): string | undefined {
  if (env) return env[name];
  return (process.env as { [key: string]: string | undefined })[name];
}

/** ARIA_OUTREACH_KILL_SWITCH. Unset, 0, and false are off. 1 and true are on. Anything else is unreadable. */
export function outreachKilled(env?: { [key: string]: string | undefined }): boolean | null {
  const raw = envValue("ARIA_OUTREACH_KILL_SWITCH", env);
  if (raw === undefined || raw.trim() === "" || /^(0|false)$/i.test(raw.trim())) return false;
  if (/^(1|true)$/i.test(raw.trim())) return true;
  return null;
}

/** ARIA_OUTREACH_DAILY_CAP. Unset is 25. A value outside 1..10000 is unusable. */
export function outreachDailyCap(env?: { [key: string]: string | undefined }): number {
  const raw = envValue("ARIA_OUTREACH_DAILY_CAP", env);
  if (raw === undefined || raw.trim() === "") return 25;
  if (!/^\d+$/.test(raw.trim())) return 0;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 10000) return 0;
  return value;
}

interface CliVerdict {
  status?: string;
  score?: number;
  qc_version?: string;
  draft_hash?: string;
  caps_ok?: boolean;
}

/** Run qc.Evaluate and qc.Admit for one draft. A missing toolchain or a bad result returns null. */
export function evaluateOutreachQc(draft: OutreachQcDraft): OutreachQcVerdict | null {
  const payload = {
    threshold: 0.9,
    draft: {
      channel: draft.channel,
      subject: draft.subject,
      body: draft.body,
      language: draft.language ?? "",
    },
    candidate: { language: draft.language ?? "", facts: [] },
    need: { facts: [] },
  };
  let stdout = "";
  let status: number | null = null;
  try {
    const proc = spawnSync("go", ["run", "./go/qc/cmd/qceval"], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 60_000,
      cwd: process.cwd(),
    });
    stdout = proc.stdout ?? "";
    status = proc.status;
  } catch {
    return null;
  }
  if (status !== 0 || !stdout.trim()) return null;
  let parsed: CliVerdict;
  try {
    parsed = JSON.parse(stdout) as CliVerdict;
  } catch {
    return null;
  }
  if ((parsed.status !== "PASS" && parsed.status !== "FAIL") || typeof parsed.score !== "number") return null;
  if (typeof parsed.qc_version !== "string" || typeof parsed.draft_hash !== "string") return null;
  return {
    status: parsed.status,
    score: parsed.score,
    qcVersion: parsed.qc_version,
    draftHash: parsed.draft_hash,
    capsOk: parsed.caps_ok === true,
  };
}
