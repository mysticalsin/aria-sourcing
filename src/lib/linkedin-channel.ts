import { classifyFailedHttpDeliveryState } from "@/lib/delivery-outcome";

export type LinkedInBackendKind = "assisted-manual" | "vendor-api";

/**
 * Internal provider and integration ids. These are DB values (agent_seats.provider,
 * integrations.id, api_keys.provider) and never operator-facing copy: the
 * product shows "LinkedIn" and "Connect LinkedIn". Components import these
 * names instead of repeating the literals (tests/linkedin-white-label.mts).
 */
export const LINKEDIN_VENDOR_PROVIDER = "LinkedIn Vendor API" as const;
export const LINKEDIN_ASSISTED_PROVIDER = "LinkedIn Assisted Manual" as const;
export const LINKEDIN_SEND_INTEGRATION_ID = "int_heyreach" as const;
export const LINKEDIN_SEND_KEY_PROVIDERS: ReadonlySet<string> = new Set(["HeyReach", "HeyReach MCP"]);

/** What the operator sees for a seat provider. The licensed delivery seat is "LinkedIn". */
export function seatProviderLabel(provider: string): string {
  return provider === LINKEDIN_VENDOR_PROVIDER ? "LinkedIn" : provider;
}

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

export interface LinkedInAdapter {
  kind: LinkedInBackendKind;
  provider: string;
  configured(): boolean;
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
  configured: () => Boolean(process.env.LINKEDIN_VENDOR_API_URL && process.env.LINKEDIN_VENDOR_API_KEY),
  async deliver(req) {
    const endpoint = process.env.LINKEDIN_VENDOR_API_URL ?? "";
    const token = process.env.LINKEDIN_VENDOR_API_KEY ?? "";
    if (!endpoint || !token) {
      return {
        status: "error",
        deliveryState: "not-sent",
        provider: "LinkedIn Vendor API",
        detail: "LINKEDIN_VENDOR_API_URL / LINKEDIN_VENDOR_API_KEY not set, LinkedIn vendor delivery refused.",
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

const adapters: Record<LinkedInBackendKind, LinkedInAdapter> = {
  "assisted-manual": assistedManualAdapter,
  "vendor-api": vendorApiAdapter,
};

export function linkedInBackendForProvider(provider: string | null | undefined): LinkedInBackendKind | null {
  const normalized = normalizeProvider(provider);
  if (normalized === "linkedin assisted manual" || normalized === "linkedin assisted-manual") return "assisted-manual";
  if (normalized === "linkedin vendor api" || normalized === "linkedin vendor-api") return "vendor-api";
  return null;
}

export function linkedInAdapterForProvider(provider: string | null | undefined): LinkedInAdapter | null {
  const backend = linkedInBackendForProvider(provider);
  return backend ? adapters[backend] : null;
}

export function getLinkedInAdapter(kind: LinkedInBackendKind): LinkedInAdapter {
  return adapters[kind];
}
