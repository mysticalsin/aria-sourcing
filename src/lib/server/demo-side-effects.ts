// Importing `next/headers` makes Next reject any accidental Client Component
// import of this module, providing a server-only poison boundary without an
// extra runtime dependency.
import { headers as serverOnlyBoundary } from "next/headers";

import {
  isPublicDemoAriaBotAllowed,
  isPublicDemoAriaBotBlocked,
  isPublicDemoSideEffectBlocked,
} from "@/lib/demo-side-effect-policy";

void serverOnlyBoundary;

/**
 * Server-only kill switch for a deliberately public demo deployment.
 *
 * Call this only after the route's normal parsing, authentication,
 * authorization, and ownership checks, but before the first provider credential
 * read, approval/claim write, queue mutation, or external request.
 */
export function publicDemoSideEffectsDisabled(): boolean {
  return isPublicDemoSideEffectBlocked();
}

/**
 * Public demo still blocks third-party OAuth / mailbox / calendar, but Fly
 * showcase can set ENABLE_PUBLIC_DEMO_ARIABOT=true so AriaBot seats and
 * Browser Computer LinkedIn delivery remain live.
 */
export function publicDemoAriaBotDisabled(): boolean {
  return isPublicDemoAriaBotBlocked();
}

export function publicDemoAriaBotEnabled(): boolean {
  return isPublicDemoAriaBotAllowed();
}

export const PUBLIC_DEMO_DRY_RUN_DETAIL =
  "Public demo: external provider access and durable delivery changes are disabled.";
