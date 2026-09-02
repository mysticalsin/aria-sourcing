import { z } from "zod";
import { LINKEDIN_DAILY_CONNECT_CAP, LINKEDIN_DAILY_MESSAGE_CAP } from "@/lib/linkedin-loop";

/**
 * Request shape for changing the workspace LinkedIn caps. The schema maximum
 * is the product ceiling, so a client cannot submit 26 and the server never
 * forwards it; the 0056 check constraint refuses it a second time.
 */
export const LinkedInCapsSchema = z.object({
  messageCap: z.number().int().min(0).max(LINKEDIN_DAILY_MESSAGE_CAP),
  connectCap: z.number().int().min(0).max(LINKEDIN_DAILY_CONNECT_CAP),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export type LinkedInCapsInput = z.infer<typeof LinkedInCapsSchema>;

/** What the Settings panel renders: limits, today's usage, and when the day rolls. */
export interface LinkedInSendingControls {
  killSwitch: boolean;
  enabled: boolean;
  persisted: boolean;
  messageCap: number;
  connectCap: number;
  timezone: string;
  messagesToday: number;
  connectsToday: number;
  resetsAt: string | null;
}

export const LINKEDIN_SENDING_OFF: LinkedInSendingControls = {
  killSwitch: true,
  enabled: false,
  persisted: false,
  messageCap: 0,
  connectCap: 0,
  timezone: "UTC",
  messagesToday: 0,
  connectsToday: 0,
  resetsAt: null,
};

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
}

/** Map the 0056 read RPC row to the panel shape. Anything missing reads as off and capped at 0. */
export function sendingControlsFromRow(row: Record<string, unknown> | null, persisted: boolean): LinkedInSendingControls {
  if (!row) return { ...LINKEDIN_SENDING_OFF, persisted };
  return {
    killSwitch: row.kill_switch !== false,
    enabled: row.enabled === true,
    persisted,
    messageCap: Math.min(LINKEDIN_DAILY_MESSAGE_CAP, Math.max(0, int(row.message_cap, 0))),
    connectCap: Math.min(LINKEDIN_DAILY_CONNECT_CAP, Math.max(0, int(row.connect_cap, 0))),
    timezone: typeof row.timezone === "string" && row.timezone ? row.timezone : "UTC",
    messagesToday: Math.max(0, int(row.messages_today, 0)),
    connectsToday: Math.max(0, int(row.connects_today, 0)),
    resetsAt: typeof row.resets_at === "string" && row.resets_at ? row.resets_at : null,
  };
}
