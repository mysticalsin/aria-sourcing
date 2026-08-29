/**
 * REI autopilot send decision — pure policy for first-touch outreach.
 *
 * Autopilot ON (entitled profile + sequences armed + critics green):
 *   draft → mint approval → queue/dispatch (Email/WA live seat; LinkedIn via HeyReach when configured)
 * Autopilot OFF:
 *   draft → Needs Approval → human Approve → human Send (or LinkedIn Pending Manual Send)
 */

export type ReiOutboundChannel = "Email" | "LinkedIn" | "WhatsApp" | "SMS";

export type ReiAutopilotSendVerdict =
  | {
      mode: "human_review";
      reason: string;
    }
  | {
      mode: "autopilot_dispatch";
      channel: ReiOutboundChannel;
      linkedInDelivery: "heyreach" | "vendor" | "assisted_manual";
      reason: string;
    };

export type ReiAutopilotSendInput = {
  /** profiles.autopilot_enabled for an entitled operator in this workspace */
  autopilotEnabled: boolean;
  /** sourcing_loop_controls: kill_switch=false && sequences_enabled */
  sequencesArmed: boolean;
  /** Live multi-agent critics ran and did not block */
  criticsPassed: boolean;
  qualityStatus: string;
  channel: ReiOutboundChannel;
  /** Live mailbox seat for Email */
  hasLiveMailbox: boolean;
  /** Live WhatsApp Cloud seat + phone */
  hasLiveWhatsApp: boolean;
  /** HeyReach API key present + integration connected */
  heyReachConfigured: boolean;
  /** LINKEDIN_VENDOR_API_* present */
  linkedInVendorConfigured: boolean;
};

/**
 * Decide whether the loop may auto-dispatch after a critic-green draft.
 * Never returns autopilot_dispatch for SMS (permanently disabled).
 */
export function decideReiAutopilotSend(input: ReiAutopilotSendInput): ReiAutopilotSendVerdict {
  if (!input.autopilotEnabled) {
    return { mode: "human_review", reason: "autopilot_disabled" };
  }
  if (!input.sequencesArmed) {
    return { mode: "human_review", reason: "sequences_not_armed" };
  }
  if (!input.criticsPassed || input.qualityStatus === "blocked") {
    return { mode: "human_review", reason: "critics_not_green" };
  }

  switch (input.channel) {
    case "SMS":
      return { mode: "human_review", reason: "sms_disabled" };
    case "Email":
      if (!input.hasLiveMailbox) {
        return { mode: "human_review", reason: "no_live_mailbox" };
      }
      return {
        mode: "autopilot_dispatch",
        channel: "Email",
        linkedInDelivery: "assisted_manual",
        reason: "email_live_seat",
      };
    case "WhatsApp":
      if (!input.hasLiveWhatsApp) {
        return { mode: "human_review", reason: "no_live_whatsapp" };
      }
      return {
        mode: "autopilot_dispatch",
        channel: "WhatsApp",
        linkedInDelivery: "assisted_manual",
        reason: "whatsapp_live_seat",
      };
    case "LinkedIn":
      if (input.heyReachConfigured) {
        return {
          mode: "autopilot_dispatch",
          channel: "LinkedIn",
          linkedInDelivery: "heyreach",
          reason: "heyreach_configured",
        };
      }
      if (input.linkedInVendorConfigured) {
        return {
          mode: "autopilot_dispatch",
          channel: "LinkedIn",
          linkedInDelivery: "vendor",
          reason: "linkedin_vendor_configured",
        };
      }
      return { mode: "human_review", reason: "linkedin_assisted_manual_only" };
    default:
      return { mode: "human_review", reason: "unknown_channel" };
  }
}

/** True when LinkedIn interactive/API send may leave assisted-manual refuse. */
export function linkedInMayAutoDeliver(delivery: ReiAutopilotSendVerdict): boolean {
  return (
    delivery.mode === "autopilot_dispatch" &&
    delivery.channel === "LinkedIn" &&
    (delivery.linkedInDelivery === "heyreach" || delivery.linkedInDelivery === "vendor")
  );
}
