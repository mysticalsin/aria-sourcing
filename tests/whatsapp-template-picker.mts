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

const pickerPath = new URL("../src/components/outreach/whatsapp-template-picker.tsx", import.meta.url);
const outreachPath = new URL("../src/app/outreach/page.tsx", import.meta.url);
const picker = existsSync(pickerPath) ? readFileSync(pickerPath, "utf8") : "";
const outreach = readFileSync(outreachPath, "utf8");
const queuePayload = picker.match(/JSON\.stringify\(\{([\s\S]*?)\}\)/)?.[1] ?? "";

ok("approved WhatsApp template picker exists", picker.length > 0);
ok("picker loads only the authenticated approved-template endpoint", /fetch\("\/api\/outreach\/whatsapp-template"/.test(picker));
ok("picker requires an explicit human approval checkbox", /type="checkbox"/.test(picker) && /humanApproval/.test(picker));
ok("picker labels each controlled field and groups parameters accessibly", /htmlFor=/.test(picker) && /<fieldset/.test(picker) && /<legend/.test(picker));
ok("picker exposes Meta template identity rather than an editable message body", /metaName/.test(picker) && /language/.test(picker) && /version/.test(picker) && !/Textarea/.test(picker));
ok("picker sends only IDs, bounded parameter values, and explicit approval", /candidateId/.test(queuePayload) && /templateId/.test(queuePayload) && /parameters/.test(queuePayload) && /humanApproval/.test(queuePayload) && !/\bbody\b/.test(queuePayload));
ok("outreach page renders the approved WhatsApp template picker", /WhatsAppTemplatePicker/.test(outreach));

console.log(`RESULT whatsapp-template-picker: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
