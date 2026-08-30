/** Shared LinkedIn outbound delivery request/outcome — no adapter imports (cycle-free). */

export interface LinkedInDeliveryRequest {
  workspaceId: string;
  messageId: string;
  candidateId: string;
  profileUrl: string;
  subject: string;
  body: string;
  attemptId: string;
}

export interface LinkedInDeliveryOutcome {
  status: "sent" | "dry-run" | "error";
  deliveryState: "accepted" | "not-sent" | "unknown";
  provider: string;
  detail: string;
  id?: string;
}
