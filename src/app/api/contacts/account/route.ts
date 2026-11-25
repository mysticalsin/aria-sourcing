import { type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { gateContactRequest, noStore } from "@/lib/contact-chat/gate";
import { linkedInAccountView, putLinkedInAccountToken, setHeyReachEnabled } from "@/lib/contact-chat/memory";

export const dynamic = "force-dynamic";

const AccountWriteSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("token"), token: z.string().min(1).max(500) }),
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("disable") }),
]);

export async function GET(req: NextRequest) {
  const denied = await gateContactRequest(req, "contacts-account-read", "view");
  if (denied) return denied;
  return noStore({ ok: true, account: linkedInAccountView() });
}

export async function POST(req: NextRequest) {
  const denied = await gateContactRequest(req, "contacts-account-write", "manage_keys");
  if (denied) return denied;

  const validated = await validateBody(req, AccountWriteSchema, { maxBytes: 4_000 });
  if (!validated.ok) return validated.response;
  const body = validated.data;

  if (body.action === "token") {
    const saved = putLinkedInAccountToken(body.token);
    return noStore(saved, saved.ok ? 200 : 400);
  }
  const toggled = setHeyReachEnabled(body.action === "enable");
  return noStore(toggled, toggled.ok ? 200 : 409);
}
