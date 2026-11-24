/* ============================================================================
   JSON schema for brief extraction, sent as Anthropic structured output
   (output_config.format) on the extract task, so the model can only answer
   with this exact shape. Built from the same enums parseIntakeJson
   validates against; that validation and groundLiveIntakeFields still run,
   because a well-formed answer can still contain unsupported facts.

   Structured outputs require additionalProperties: false and every property
   listed in required, and reject numeric or length constraints. Unknown
   strings are "" and unknown numbers null, as the prompt asks.
   ========================================================================== */

import {
  COMPANY_STAGES,
  EMPLOYMENT_TYPES,
  INTAKE_INTENTS,
  LOCATION_TYPES,
  SENIORITY_LEVELS,
  URGENCY_LEVELS,
} from "@/lib/types";

const text = { type: "string" } as const;
const texts = { type: "array", items: { type: "string" } } as const;
const numberOrNull = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const oneOf = (values: readonly string[]) => ({ type: "string", enum: [...values, ""] });

const properties = {
  senderName: text,
  senderEmail: text,
  intent: oneOf(INTAKE_INTENTS),
  urgency: oneOf(URGENCY_LEVELS),
  title: text,
  department: text,
  seniority: oneOf(SENIORITY_LEVELS),
  employmentType: oneOf(EMPLOYMENT_TYPES),
  locationType: oneOf(LOCATION_TYPES),
  regions: texts,
  timezone: text,
  salaryMin: numberOrNull,
  salaryMax: numberOrNull,
  currency: text,
  equity: { type: "boolean" },
  requiredSkills: texts,
  niceToHaveSkills: texts,
  minYearsExperience: numberOrNull,
  maxYearsExperience: numberOrNull,
  education: text,
  industryExperience: texts,
  companyStageTarget: { type: "array", items: { type: "string", enum: [...COMPANY_STAGES] } },
  teamSize: text,
  reportingTo: text,
  language: text,
};

export const INTAKE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
} as const;
