import { type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { searchPeople } from "@/lib/contact-chat/apify-people";
import { gateContactRequest, noStore } from "@/lib/contact-chat/gate";

export const dynamic = "force-dynamic";

const SearchSchema = z.object({
  query: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const denied = await gateContactRequest(req, "contacts-search", "view");
  if (denied) return denied;

  const validated = await validateBody(req, SearchSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;

  const result = await searchPeople(validated.data.query ?? "");
  if (!result.ok) {
    return noStore({ ok: false, people: [], cap: result.cap, message: "People search refused that connector." }, 400);
  }
  return noStore({ ok: true, people: result.people, cap: result.cap });
}
