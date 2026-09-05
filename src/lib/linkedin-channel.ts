import { classifyFailedHttpDeliveryState } from "@/lib/delivery-outcome";
import { defaultComputerSupervisor, bindComputerSupervisorEndpoint } from "@/lib/computer-supervisor";
import {
  browserComputerConfigured,
  vendorApiConfigured,
  type LinkedInResolvedCredentials,
} from "@/lib/linkedin-credentials";

export type LinkedInBackendKind = "assisted-manual" | "vendor-api" | "browser-computer";

export interface LinkedInDeliveryRequest {
  workspaceId: string;
  messageId: string;
  candidateId: string;
  profileUrl: string;
  subject: string;
  body: string;
  attemptId: string;
  /** Seat id — required for browser-computer path (1 seat = 1 computer). */
  seatId?: string;
  /** Aria vault / Settings-resolved credentials (env fallback inside helpers). */
  credentials?: Partial<LinkedInResolvedCredentials>;
}

export interface LinkedInDeliveryOutcome {
  status: "sent" | "dry-run" | "error";
  deliveryState: "accepted" | "not-sent" | "unknown";
  provider: string;
  detail: string;
  id?: string;
}

export interface LinkedInAdapter {
  kind: LinkedInBackendKind;
  provider: string;
  configured(credentials?: Partial<LinkedInResolvedCredentials>): boolean;
  deliver(req: LinkedInDeliveryRequest): Promise<LinkedInDeliveryOutcome>;
}

const TIMEOUT = 15_000;

function normalizeProvider(provider: string | null | undefined): string {
  return (provider ?? "").trim().toLowerCase();
}

const assistedManualAdapter: LinkedInAdapter = {
  kind: "assisted-manual",
  provider: "LinkedIn Assisted Manual",
  configured: () => true,
  async deliver(req) {
    const profileUrl = req.profileUrl.trim();
    if (!profileUrl) {
      return {
        status: "error",
        deliveryState: "not-sent",
        provider: "LinkedIn Assisted Manual",
        detail: "LinkedIn profile URL is required for assisted-manual delivery.",
      };
    }
    return {
      status: "sent",
      deliveryState: "accepted",
      provider: "LinkedIn Assisted Manual",
      detail: "Approved LinkedIn draft is ready for operator copy/paste/send.",
      id: req.attemptId,
    };
  },
};

const vendorApiAdapter: LinkedInAdapter = {
  kind: "vendor-api",
  provider: "LinkedIn Vendor API",
  configured: (credentials) => vendorApiConfigured(credentials),
  async deliver(req) {
    const creds = req.credentials;
    const endpoint = (creds?.vendorApiUrl ?? process.env.LINKEDIN_VENDOR_API_URL ?? "").trim();
    const token = (creds?.vendorApiKey ?? process.env.LINKEDIN_VENDOR_API_KEY ?? "").trim();
    if (!endpoint || !token) {
      return {
        status: "error",
        deliveryState: "not-sent",
        provider: "LinkedIn Vendor API",
        detail: "LinkedIn Vendor API is not configured in Aria Settings (or LINKEDIN_VENDOR_* env). Delivery refused.",
      };
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: req.workspaceId,
          messageId: req.messageId,
          candidateId: req.candidateId,
          profileUrl: req.profileUrl,
          subject: req.subject,
          body: req.body,
          attemptId: req.attemptId,
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) {
        return {
          status: "error",
          deliveryState: classifyFailedHttpDeliveryState(res.status),
          provider: "LinkedIn Vendor API",
          detail: `LinkedIn vendor API ${res.status}`,
        };
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
      const providerId = (data.id ?? data.messageId ?? "").trim();
      if (!providerId) {
        return {
          status: "error",
          deliveryState: "unknown",
          provider: "LinkedIn Vendor API",
          detail: "LinkedIn vendor response did not include a durable message id.",
        };
      }
      return {
        status: "sent",
        deliveryState: "accepted",
        provider: "LinkedIn Vendor API",
        detail: "Sent through LinkedIn vendor API.",
        id: providerId,
      };
    } catch (err) {
      return {
        status: "error",
        deliveryState: "unknown",
        provider: "LinkedIn Vendor API",
        detail: err instanceof Error ? err.message : "LinkedIn vendor delivery failed.",
      };
    }
  },
};

/**
 * OpenBot-shaped browser computer: isolated Chromium per seat.
 * Research browser tools must NEVER be reused for LinkedIn send.
 * Contact permission is already enforced by claim_contact before dispatch.
 */
const browserComputerAdapter: LinkedInAdapter = {
  kind: "browser-computer",
  provider: "LinkedIn Browser Computer",
  configured: (credentials) => browserComputerConfigured(credentials),
  async deliver(req) {
    const profileUrl = req.profileUrl.trim();
    if (!profileUrl) {
      return {
        status: "error",
        deliveryState: "not-sent",
        provider: "LinkedIn Browser Computer",
        detail: "LinkedIn profile URL is required for browser-computer delivery.",
      };
    }
    if (!req.seatId) {
      return {
        status: "error",
        deliveryState: "not-sent",
        provider: "LinkedIn Browser Computer",
        detail: "seatId is required so the supervisor can bind 1 seat → 1 computer.",
      };
    }

    const bind = {
      url: req.credentials?.computerSupervisorUrl,
      token: req.credentials?.computerSupervisorToken,
      // Same secret OpenBot injects into agent-computers (COMPUTER_TOKEN).
      computerToken:
        process.env.OPENBOT_COMPUTER_TOKEN?.trim() ||
        process.env.COMPUTER_TOKEN?.trim() ||
        undefined,
      mockSend: req.credentials?.computerSupervisorMockSend,
    };
    bindComputerSupervisorEndpoint(bind);
    try {
      const computer = defaultComputerSupervisor.ensureComputer({
        workspaceId: req.workspaceId,
        seatId: req.seatId,
      });
      if (computer.control === "human") {
        return {
          status: "error",
          deliveryState: "not-sent",
          provider: "LinkedIn Browser Computer",
          detail: "Human has control of this computer — bot send refused until Release.",
        };
      }
      if (computer.status === "stopped" || computer.status === "error") {
        await defaultComputerSupervisor.start(computer.computerId);
      }

      const job = await defaultComputerSupervisor.enqueueJob({
        computerId: computer.computerId,
        kind: "linkedin_send",
        payload: {
          workspaceId: req.workspaceId,
          messageId: req.messageId,
          candidateId: req.candidateId,
          profileUrl,
          subject: req.subject,
          body: req.body,
          attemptId: req.attemptId,
        },
      });

      if (job.status === "refused") {
        return {
          status: "error",
          deliveryState: "not-sent",
          provider: "LinkedIn Browser Computer",
          detail: job.detail || "Computer refused job (human mutex or not ready).",
        };
      }
      if (job.status === "failed") {
        return {
          status: "error",
          deliveryState: "unknown",
          provider: "LinkedIn Browser Computer",
          detail: job.detail || "Browser-computer job failed.",
        };
      }
      if (job.status !== "succeeded") {
        return {
          status: "error",
          deliveryState: "unknown",
          provider: "LinkedIn Browser Computer",
          detail: `Browser-computer job ended in ${job.status}.`,
        };
      }

      const supervisorReady = browserComputerConfigured(req.credentials);
      // Mock / queued-local path: only treat as accepted when explicitly mocked or remote ACK.
      if (supervisorReady) {
        return {
          status: "sent",
          deliveryState: "accepted",
          provider: "LinkedIn Browser Computer",
          detail: job.detail,
          id: job.jobId,
        };
      }

      return {
        status: "error",
        deliveryState: "not-sent",
        provider: "LinkedIn Browser Computer",
        detail:
          "Computer supervisor is not configured in Aria Settings (or COMPUTER_SUPERVISOR_URL). Automatic browser send refused — open Settings → LinkedIn.",
      };
    } catch (err) {
      return {
        status: "error",
        deliveryState: "unknown",
        provider: "LinkedIn Browser Computer",
        detail: err instanceof Error ? err.message : "Browser-computer delivery failed.",
      };
    } finally {
      bindComputerSupervisorEndpoint(null);
    }
  },
};

const adapters: Record<LinkedInBackendKind, LinkedInAdapter> = {
  "assisted-manual": assistedManualAdapter,
  "vendor-api": vendorApiAdapter,
  "browser-computer": browserComputerAdapter,
};

export {
  LINKEDIN_AUTOMATIC_PROVIDERS,
  isLinkedInAutomaticProvider,
} from "@/lib/linkedin-automatic";

export function linkedInBackendForProvider(provider: string | null | undefined): LinkedInBackendKind | null {
  const normalized = normalizeProvider(provider);
  if (normalized === "linkedin assisted manual" || normalized === "linkedin assisted-manual") {
    return "assisted-manual";
  }
  if (normalized === "linkedin vendor api" || normalized === "linkedin vendor-api") {
    return "vendor-api";
  }
  if (
    normalized === "linkedin browser computer" ||
    normalized === "linkedin browser-computer" ||
    normalized === "linkedin computer"
  ) {
    return "browser-computer";
  }
  return null;
}

export function linkedInAdapterForProvider(provider: string | null | undefined): LinkedInAdapter | null {
  const backend = linkedInBackendForProvider(provider);
  return backend ? adapters[backend] : null;
}

export function getLinkedInAdapter(kind: LinkedInBackendKind): LinkedInAdapter {
  return adapters[kind];
}
