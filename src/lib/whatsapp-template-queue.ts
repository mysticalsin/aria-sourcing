/**
 * Canonical audit payload for a Meta-approved WhatsApp template dispatch.
 *
 * The stored `messages_outbound.body` is deliberately an audit artifact for a
 * template dispatch, not candidate-facing free-form copy. Both the queue route
 * and the dispatcher build it from the trusted template record plus bounded,
 * normalized parameters. A changed template identity or parameter therefore
 * changes the approval hash and blocks delivery.
 */

export const MAX_WHATSAPP_TEMPLATE_PARAMETERS = 10;
export const MAX_WHATSAPP_TEMPLATE_PARAMETER_LENGTH = 1_024;
export const APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT = "WhatsApp approved-template dispatch";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_TEMPLATE_NAME = /^[A-Za-z0-9_]{1,512}$/;
const META_TEMPLATE_LANGUAGE = /^[a-z]{2,3}_[A-Z]{2}$/;
const PARAMETER_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

export interface WhatsAppTemplateParameterDefinition {
  name: string;
  maxLength: number;
}

export interface ApprovedWhatsAppTemplateIdentity {
  id: string;
  senderId: string;
  metaName: string;
  language: string;
  version: number;
}

export interface ApprovedWhatsAppTemplateAudit {
  /** Exact immutable audit payload that is persisted in `messages_outbound.body`. */
  body: string;
  /** Normalized values passed to the Meta template adapter after approval verification. */
  parameters: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the parameter schema from the trusted catalog. We intentionally fail
 * closed for templates with placeholders but no per-placeholder bounds.
 */
export function parseApprovedWhatsAppTemplateParameterSchema(
  raw: unknown,
  bodyParameterCount: unknown,
): WhatsAppTemplateParameterDefinition[] | null {
  if (
    typeof bodyParameterCount !== "number" ||
    !Number.isInteger(bodyParameterCount) ||
    bodyParameterCount < 0 ||
    bodyParameterCount > MAX_WHATSAPP_TEMPLATE_PARAMETERS
  ) {
    return null;
  }
  if (!Array.isArray(raw) || raw.length !== bodyParameterCount) return null;

  const names = new Set<string>();
  const parameters: WhatsAppTemplateParameterDefinition[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.name !== "string") return null;
    const name = item.name.trim();
    const suppliedMaxLength = item.max_length ?? item.maxLength;
    if (!PARAMETER_NAME.test(name) || names.has(name)) return null;
    if (
      !Number.isInteger(suppliedMaxLength) ||
      typeof suppliedMaxLength !== "number" ||
      suppliedMaxLength < 1 ||
      suppliedMaxLength > MAX_WHATSAPP_TEMPLATE_PARAMETER_LENGTH
    ) {
      return null;
    }
    names.add(name);
    parameters.push({ name, maxLength: suppliedMaxLength });
  }
  return parameters;
}

function normalizeParameter(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maxLength || CONTROL_CHARACTER.test(normalized)) return null;
  return normalized;
}

function validTemplateIdentity(template: ApprovedWhatsAppTemplateIdentity): boolean {
  return (
    UUID.test(template.id) &&
    UUID.test(template.senderId) &&
    META_TEMPLATE_NAME.test(template.metaName) &&
    META_TEMPLATE_LANGUAGE.test(template.language) &&
    Number.isInteger(template.version) &&
    template.version > 0
  );
}

/**
 * Builds the only body accepted for a cold template dispatch. The order and
 * field names are fixed so JSON serialization remains a deterministic audit
 * payload. This data never becomes a free-form WhatsApp message.
 */
export function buildApprovedWhatsAppTemplateAudit(input: {
  template: ApprovedWhatsAppTemplateIdentity;
  parameterSchema: WhatsAppTemplateParameterDefinition[];
  parameters: unknown;
}): ApprovedWhatsAppTemplateAudit | null {
  if (!validTemplateIdentity(input.template) || !Array.isArray(input.parameters)) return null;
  if (
    input.parameterSchema.length > MAX_WHATSAPP_TEMPLATE_PARAMETERS ||
    input.parameters.length !== input.parameterSchema.length
  ) {
    return null;
  }

  const parameters: string[] = [];
  for (let index = 0; index < input.parameterSchema.length; index += 1) {
    const definition = input.parameterSchema[index];
    if (!definition || !PARAMETER_NAME.test(definition.name) || !Number.isInteger(definition.maxLength)) return null;
    const normalized = normalizeParameter(input.parameters[index], definition.maxLength);
    if (normalized === null) return null;
    parameters.push(normalized);
  }

  return {
    parameters,
    body: JSON.stringify({
      audit_version: 1,
      kind: "meta_approved_whatsapp_template",
      template: {
        id: input.template.id,
        sender_id: input.template.senderId,
        meta_name: input.template.metaName,
        language: input.template.language,
        version: input.template.version,
      },
      parameters: input.parameterSchema.map((definition, index) => ({
        name: definition.name,
        value: parameters[index],
      })),
    }),
  };
}
