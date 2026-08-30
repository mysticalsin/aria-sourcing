import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const routePath = new URL("../src/app/api/outreach/whatsapp-template/route.ts", import.meta.url);
const route = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";

ok("approved-template queue route exists", route.length > 0);
ok("queue route requires an authenticated outreach operator", /auth\.getUser\(\)/.test(route) && /can\(role as Role, "outreach"\)/.test(route));
ok("queue route rate limits reads and human approval writes", /whatsapp-template-read/.test(route) && /whatsapp-template-queue/.test(route));
ok("queue route accepts only a strict metadata-and-parameter payload", /WhatsAppTemplateQueueSchema[\s\S]*?\.strict\(\)/.test(route));
ok("queue route requires an explicit human approval confirmation", /humanApproval:\s*z\.literal\(true\)/.test(route));
ok("queue route resolves only an active sender and Meta-approved template", /whatsapp_senders/.test(route) && /status", "active"/.test(route) && /whatsapp_templates/.test(route) && /status", "approved"/.test(route) && /sender_id/.test(route));
ok("queue route derives canonical audit content instead of accepting a body", /buildApprovedWhatsAppTemplateAudit/.test(route) && /APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT/.test(route) && !/body:\s*z\.string/.test(route));
ok("queue route records the server-derived approval before queuing", /rpc\("record_outreach_approval"/.test(route) && /approvalHash\(/.test(route) && /approvalScopeHash\(/.test(route));
ok(
  "queue route enforces live multi-agent critics like approve (fail-closed on production)",
  /validateOutreachQualityLive/.test(route)
    && /outreachQualityGate/.test(route)
    && /critics_required/.test(route)
    && /demoLoginEnabled/.test(route)
    && route.indexOf("validateOutreachQualityLive") < route.indexOf('rpc("record_outreach_approval"'),
);
ok(
  "queue route delegates the exact approved_template outbox write to database authority",
  /rpc\("enqueue_whatsapp_outbound"/.test(route) &&
    /p_type:\s*"approved_template"/.test(route) &&
    /p_template_parameters:\s*audit\.parameters/.test(route) &&
    !/\.from\("messages_outbound"\)\s*\.insert/.test(route),
);
ok("queue route does not bypass the dispatcher with a direct Meta call", !/sendWhatsApp/.test(route) && /dispatchDue/.test(route));
ok("queue route rejects cross-origin or non-JSON browser writes", /content-type/.test(route) && /req\.nextUrl\.origin/.test(route));

console.log(`RESULT whatsapp-template-queue-route: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
