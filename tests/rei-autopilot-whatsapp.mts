/* ============================================================================
   tests/rei-autopilot-whatsapp.mts — cold vs reply-window shape for WA autopilot
   ========================================================================== */

import { resolveWhatsAppAutopilotShape } from "../src/lib/rei-autopilot-whatsapp";
import type { SupabaseClient } from "@supabase/supabase-js";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

type Row = Record<string, unknown>;

function makeSvc(opts: {
  contact?: Row | null;
  sender?: Row | null;
  templates?: Row[];
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = () => self();
      chain.eq = () => self();
      chain.limit = () => self();
      chain.maybeSingle = async () => {
        if (table === "whatsapp_contacts") {
          return { data: opts.contact === undefined ? null : opts.contact, error: null };
        }
        if (table === "whatsapp_senders") {
          return { data: opts.sender === undefined ? null : opts.sender, error: null };
        }
        return { data: null, error: null };
      };
      const thenable = {
        then(resolve: (v: unknown) => void) {
          if (table === "whatsapp_templates") {
            resolve({ data: opts.templates ?? [], error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      Object.assign(chain, thenable);
      chain.eq = () => Object.assign(self(), thenable);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const base = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  seatId: "seat-wa-1",
  recipient: "+15551234567",
  subject: "Hello",
  body: "Free-form draft body.",
};

{
  const inboundAt = new Date(Date.now() - 30_000).toISOString();
  const shape = await resolveWhatsAppAutopilotShape(
    makeSvc({
      contact: {
        consent_status: "opted_in",
        recipient_e164: "15551234567",
        recorded_at: inboundAt,
        expires_at: null,
        last_inbound_at: inboundAt,
      },
    }),
    base,
  );
  ok("open window → candidate_reply", shape.kind === "candidate_reply");
}

{
  const senderId = "22222222-2222-4222-8222-222222222201";
  const shape = await resolveWhatsAppAutopilotShape(
    makeSvc({
      contact: null,
      sender: { id: senderId },
      templates: [
        {
          id: "11111111-1111-4111-8111-111111111101",
          sender_id: senderId,
          meta_name: "intro_zero",
          language: "en_US",
          version: 1,
          status: "approved",
          parameter_schema: [],
          body_parameter_count: 0,
        },
      ],
    }),
    base,
  );
  ok("cold zero-param → approved_template", shape.kind === "approved_template");
  if (shape.kind === "approved_template") {
    ok("audit subject set", shape.subject === "WhatsApp approved-template dispatch");
    ok("audit body is JSON", shape.body.includes("meta_approved_whatsapp_template"));
  }
}

{
  const shape = await resolveWhatsAppAutopilotShape(
    makeSvc({ contact: null, sender: null, templates: [] }),
    base,
  );
  ok(
    "cold without template → skip",
    shape.kind === "skip" && shape.reason === "whatsapp_cold_requires_template",
  );
}

console.log(`RESULT rei-autopilot-whatsapp: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
