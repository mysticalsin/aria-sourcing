import { supabaseEnabled } from "@/lib/supabase/config";
import { LINKEDIN_VENDOR_PROVIDER, linkedInAdapterForProvider } from "@/lib/linkedin-channel";

/**
 * Is LinkedIn sending enabled on this deployment? Server only. True needs
 * the delivery adapter's endpoint and key plus the LinkedIn sign-in app.
 * The browser never infers this; it asks GET /api/outreach/linkedin/sender.
 */
export function linkedInSendingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!supabaseEnabled) return false;
  const adapter = linkedInAdapterForProvider(LINKEDIN_VENDOR_PROVIDER);
  return Boolean(adapter?.configured()) && Boolean(env.LINKEDIN_CLIENT_ID);
}
