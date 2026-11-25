import { type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { gateContactRequest, noStore } from "@/lib/contact-chat/gate";
import { sendContactMessage } from "@/lib/contact-chat/send";

export const dynamic = "force-dynamic";

const SendSchema = z.object({
  personId: z.string().min(1).max(64),
  text: z.string().min(1).max(4_000),
});

export async function POST(req: NextRequest) {
  const denied = await gateContactRequest(req, "contacts-send", "outreach");
  if (denied) return denied;

  const validated = await validateBody(req, SendSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;

  const result = await sendContactMessage({
    personId: validated.data.personId,
    text: validated.data.text,
  });
  return noStore(result, result.ok ? 200 : 409);
}
