export type LinkedInBackendKind = "assisted-manual" | "vendor-api";

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

function normalizeProvider(provider: string | null | undefined): string {
  return (provider ?? "").trim().toLowerCase();
}

function linkedInDeliveryRefused(provider: string): LinkedInDeliveryOutcome {
  return {
    status: "error",
    deliveryState: "not-sent",
    provider,
    detail: "Aria does not deliver to LinkedIn.",
  };
}

const assistedManualAdapter: LinkedInAdapter = {
  kind: "assisted-manual",
  provider: "LinkedIn Assisted Manual",
  configured: () => true,
  async deliver() {
    return linkedInDeliveryRefused("LinkedIn Assisted Manual");
  },
};

const vendorApiAdapter: LinkedInAdapter = {
  kind: "vendor-api",
  provider: "LinkedIn Vendor API",
  configured: () => Boolean(process.env.LINKEDIN_VENDOR_API_URL && process.env.LINKEDIN_VENDOR_API_KEY),
  async deliver() {
    return linkedInDeliveryRefused("LinkedIn Vendor API");
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
