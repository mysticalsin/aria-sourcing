import { redirect } from "next/navigation";

/* The LinkedIn inbox is gone: LinkedIn now lives on each sourced candidate
 * (their conversation, an invitation) and the connection in Settings. Old links
 * (the extension 0.2 popup, /linkedin?candidate=<id>) land in the right place. */
export default async function LinkedInRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const candidate = typeof params.candidate === "string" ? params.candidate : null;
  redirect(candidate ? `/candidates?focus=${encodeURIComponent(candidate)}` : "/settings?tab=integrations#linkedin");
}
