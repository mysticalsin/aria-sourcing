import { type NextRequest } from "next/server";
import { gateContactRequest, noStore } from "@/lib/contact-chat/gate";
import { readContactThread } from "@/lib/contact-chat/send";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await gateContactRequest(req, "contacts-thread", "view");
  if (denied) return denied;

  const personId = req.nextUrl.searchParams.get("personId") ?? "";
  const thread = readContactThread(personId);
  if (!thread) return noStore({ ok: false, message: "Choose a person first." }, 400);
  return noStore({ ok: true, threadId: thread.id, personId: thread.personId, messages: thread.messages });
}
