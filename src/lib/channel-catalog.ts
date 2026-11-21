/**
 * Outreach channels. HeyReach and the LinkedIn token stay off unless a future
 * admin flag turns them on. This catalog is the default: both are off.
 */

export const CHANNEL_IDS = ["assisted-inmail", "email", "heyreach", "linkedin-token"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export interface ChannelOption {
  id: ChannelId;
  label: string;
  flag: "on" | "off";
  adminOnly: boolean;
  cap: string;
  safeguard: string;
  risk: string;
  /** A person records the send. Nothing is delivered by this control. */
  markSent: boolean;
  defaultSelected: boolean;
}

export const CHANNEL_CATALOG: readonly ChannelOption[] = [
  {
    id: "assisted-inmail",
    label: "Assisted Recruiter InMail",
    flag: "on",
    adminOnly: false,
    cap: "Recruiter's own InMail allowance",
    safeguard: "A person sends from Recruiter. A manual Mark sent step records it.",
    risk: "None",
    markSent: true,
    defaultSelected: true,
  },
  {
    id: "email",
    label: "Email",
    flag: "on",
    adminOnly: false,
    cap: "50 per sender / day",
    safeguard: "Opt-out, notice, and a recorded lawful basis.",
    risk: "GDPR only",
    markSent: false,
    defaultSelected: false,
  },
  {
    id: "heyreach",
    label: "HeyReach",
    flag: "off",
    adminOnly: false,
    cap: "20 invites, 40 messages",
    safeguard: "Admin enable, pacing, auto-pause, and a kill switch. The flag is off.",
    risk: "Breaches LinkedIn §8.2; medium-high ban risk",
    markSent: false,
    defaultSelected: false,
  },
  {
    id: "linkedin-token",
    label: "LinkedIn token",
    flag: "off",
    adminOnly: true,
    cap: "20 invites, 40 messages",
    safeguard: "Admin enable with a risk notice. Encrypted, never logged, purged when off.",
    risk: "Breaches LinkedIn §8.2; high ban risk",
    markSent: false,
    defaultSelected: false,
  },
];

export function defaultChannelId(channels: readonly ChannelOption[] = CHANNEL_CATALOG): ChannelId {
  const selected = channels.find((channel) => channel.defaultSelected && channel.flag === "on");
  return selected?.id ?? "assisted-inmail";
}
