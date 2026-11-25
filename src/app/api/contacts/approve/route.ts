import { type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { gateContactRequest, noStore } from "@/lib/contact-chat/gate";
import { approveExactText, isPersonId } from "@/lib/contact-chat/memory";

export const dynamic = "force-dynamic";

const ApproveSchema = z.object({
  personId: z.string().min(1).max(64),
  text: z.string().min(1).max(4_000),
});

export async function POST(req: NextRequest) {
  const denied = await gateContactRequest(req, "contacts-approve", "outreach");
  if (denied) return denied;

  const validated = await validateBody(req, ApproveSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  if (!isPersonId(validated.data.personId)) {
    return noStore({ ok: false, reason: "person", message: "Choose a person first." }, 400);
  }

  const approved = approveExactText(validated.data.personId, validated.data.text);
  return noStore(approved, approved.ok ? 200 : 400);
}
