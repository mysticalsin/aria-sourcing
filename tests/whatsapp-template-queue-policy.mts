import {
  buildApprovedWhatsAppTemplateAudit,
  parseApprovedWhatsAppTemplateParameterSchema,
} from "../src/lib/whatsapp-template-queue";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const schema = parseApprovedWhatsAppTemplateParameterSchema(
  [
    { name: "first_name", max_length: 80 },
    { name: "role_title", maxLength: 160 },
  ],
  2,
);

ok("bounded catalog parameter schema accepts named limits", schema !== null && schema[1]?.maxLength === 160);
ok(
  "unbounded or malformed catalog parameter schemas fail closed",
  parseApprovedWhatsAppTemplateParameterSchema(["first_name"], 1) === null &&
    parseApprovedWhatsAppTemplateParameterSchema([{ name: "first name", max_length: 80 }], 1) === null,
);

const audit = schema
  ? buildApprovedWhatsAppTemplateAudit({
      template: {
        id: "bd5500e3-7249-4d88-a37d-62bf1b87d2f5",
        senderId: "7ee4a146-f85d-4f93-ae07-2a21bf8a70de",
        metaName: "role_intro_v2",
        language: "en_US",
        version: 2,
      },
      parameterSchema: schema,
      parameters: ["  Ame\u0301lie  ", "Senior Platform Engineer"],
    })
  : null;

ok("canonical audit payload is created from template identity and normalized parameters", audit !== null);
ok(
  "parameter normalization is deterministic and avoids leading/trailing ambiguity",
  audit?.parameters[0] === "Amélie" && audit?.body.includes("Amélie") === true,
);

const changedTemplate = schema
  ? buildApprovedWhatsAppTemplateAudit({
      template: {
        id: "a312e4e1-e751-45f0-af2c-d61942fc9ea4",
        senderId: "7ee4a146-f85d-4f93-ae07-2a21bf8a70de",
        metaName: "role_intro_v2",
        language: "en_US",
        version: 2,
      },
      parameterSchema: schema,
      parameters: ["Amélie", "Senior Platform Engineer"],
    })
  : null;
const changedParameter = schema
  ? buildApprovedWhatsAppTemplateAudit({
      template: {
        id: "bd5500e3-7249-4d88-a37d-62bf1b87d2f5",
        senderId: "7ee4a146-f85d-4f93-ae07-2a21bf8a70de",
        metaName: "role_intro_v2",
        language: "en_US",
        version: 2,
      },
      parameterSchema: schema,
      parameters: ["Amélie", "Principal Platform Engineer"],
    })
  : null;

ok(
  "canonical audit payload changes if the selected template identity changes",
  audit !== null && changedTemplate !== null && audit.body !== changedTemplate.body,
);
ok(
  "canonical audit payload changes if any approved parameter changes",
  audit !== null && changedParameter !== null && audit.body !== changedParameter.body,
);
ok(
  "canonical audit payload binds name, language, sender, and version as well as template id",
  schema !== null &&
    [
      { id: "bd5500e3-7249-4d88-a37d-62bf1b87d2f5", senderId: "77d982c0-9bbc-4fc5-b8ba-8bff64f050f3", metaName: "role_intro_v2", language: "en_US", version: 2 },
      { id: "bd5500e3-7249-4d88-a37d-62bf1b87d2f5", senderId: "7ee4a146-f85d-4f93-ae07-2a21bf8a70de", metaName: "role_intro_v3", language: "en_US", version: 2 },
      { id: "bd5500e3-7249-4d88-a37d-62bf1b87d2f5", senderId: "7ee4a146-f85d-4f93-ae07-2a21bf8a70de", metaName: "role_intro_v2", language: "fr_FR", version: 2 },
      { id: "bd5500e3-7249-4d88-a37d-62bf1b87d2f5", senderId: "7ee4a146-f85d-4f93-ae07-2a21bf8a70de", metaName: "role_intro_v2", language: "en_US", version: 3 },
    ].every((template) => {
      const changed = buildApprovedWhatsAppTemplateAudit({
        template,
        parameterSchema: schema,
        parameters: ["Amélie", "Senior Platform Engineer"],
      });
      return changed !== null && audit !== null && changed.body !== audit.body;
    }),
);
ok(
  "parameter values over their selected template bound are rejected",
  schema !== null &&
    buildApprovedWhatsAppTemplateAudit({
      template: {
        id: "bd5500e3-7249-4d88-a37d-62bf1b87d2f5",
        senderId: "7ee4a146-f85d-4f93-ae07-2a21bf8a70de",
        metaName: "role_intro_v2",
        language: "en_US",
        version: 2,
      },
      parameterSchema: schema,
      parameters: ["Amélie", "x".repeat(161)],
    }) === null,
);

console.log(`RESULT whatsapp-template-queue-policy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
