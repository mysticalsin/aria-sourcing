#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DOMAIN_MAX_LENGTH = 253;
const LABEL_MAX_LENGTH = 63;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidEmailDomain(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > DOMAIN_MAX_LENGTH) return false;
  if (value !== value.trim() || value !== value.toLowerCase()) return false;

  const labels = value.split(".");
  if (labels.length < 2 || !/[a-z]/.test(labels.at(-1) ?? "")) return false;
  return labels.every(
    (label) => label.length > 0 && label.length <= LABEL_MAX_LENGTH && DNS_LABEL.test(label),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!isValidEmailDomain(process.argv[2] ?? "")) {
    console.error("ARIA_ALLOWED_EMAIL_DOMAIN must be one canonical lowercase DNS domain.");
    process.exit(1);
  }
}
