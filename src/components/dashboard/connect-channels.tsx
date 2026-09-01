"use client";

import Link from "next/link";
import {
  CONNECT_CHANNELS_COPY,
  CONNECT_LINKEDIN_LABEL,
  CONNECT_OUTLOOK_LABEL,
  linkedinConnectHref,
  needsChannelConnect,
  outlookConnectHref,
} from "@/lib/sourcing/people-connect";
import { hasValidApifyKey } from "@/lib/sourcing/people-plugins";
import type { AgentSeat, ApiKey, IntegrationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { KeyRound, Linkedin, Mail } from "lucide-react";

export function ConnectChannels({
  seats,
  integrations = [],
  apiKeys = [],
  className,
}: {
  seats: AgentSeat[];
  integrations?: IntegrationStatus[];
  apiKeys?: ApiKey[];
  className?: string;
}) {
  const showChannels = needsChannelConnect(seats, integrations, apiKeys);
  const showApify = !hasValidApifyKey(apiKeys);
  if (!showChannels && !showApify) return null;

  return (
    <div
      data-testid="cc-connect-channels"
      role="region"
      aria-label="Connect sourcing and send channels"
      className={cn(
        "mt-3 space-y-3 rounded-2xl border border-line bg-canvas px-4 py-3",
        className,
      )}
    >
      <p className="text-sm text-ink">{CONNECT_CHANNELS_COPY}</p>
      <div className="flex flex-wrap gap-2">
        {showApify ? (
          <Link
            data-testid="cc-connect-apify"
            href="/settings"
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-tangerine px-4 text-sm font-semibold text-white"
          >
            <KeyRound className="h-4 w-4" aria-hidden />
            Add Apify key
          </Link>
        ) : null}
        {showChannels ? (
          <>
            <a
              data-testid="cc-connect-linkedin"
              href={linkedinConnectHref(seats)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-paper"
            >
              <Linkedin className="h-4 w-4" aria-hidden />
              {CONNECT_LINKEDIN_LABEL}
            </a>
            <a
              data-testid="cc-connect-outlook"
              href={outlookConnectHref(seats)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink/15 bg-surface px-4 text-sm font-semibold text-ink"
            >
              <Mail className="h-4 w-4" aria-hidden />
              {CONNECT_OUTLOOK_LABEL}
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}
