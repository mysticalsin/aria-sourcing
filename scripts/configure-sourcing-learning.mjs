#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_RE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/i;

function required(name, fallback = "") {
  const value = (process.env[name] ?? fallback).trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(name, minimum, maximum) {
  const value = Number.parseInt(required(name), 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

const supabaseUrl = required("SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const workspaceId = required("SOURCING_LEARNING_WORKSPACE_ID");
const adminId = required("SOURCING_LEARNING_ADMIN_ID");
const enabledText = required("SOURCING_LEARNING_ENABLED");
const enabled = enabledText === "true" ? true : enabledText === "false" ? false : null;
const image = required("GRAPHIFY_LESSONS_IMAGE");
const expectedVersion = boundedInteger("SOURCING_LEARNING_EXPECTED_VERSION", 1, Number.MAX_SAFE_INTEGER);
const workspaceDailyLimit = boundedInteger("SOURCING_LEARNING_WORKSPACE_DAILY_LIMIT", 1, 1_000);
const userDailyLimit = boundedInteger("SOURCING_LEARNING_USER_DAILY_LIMIT", 1, 250);
const minimumEvidenceRuns = boundedInteger("SOURCING_LEARNING_MIN_EVIDENCE_RUNS", 2, 10);
const lessonTtlDays = boundedInteger("SOURCING_LEARNING_LESSON_TTL_DAYS", 7, 365);
const requestId = required("SOURCING_LEARNING_REQUEST_ID");
const confirmation = required("SOURCING_LEARNING_CONFIRM");

if (![workspaceId, adminId].every((value) => UUID_RE.test(value))) {
  throw new Error("Workspace and admin IDs must be UUIDs");
}
if (enabled === null || !IMAGE_RE.test(image)) {
  throw new Error("Learning status or Graphify image digest is invalid");
}
if (!/^[A-Za-z0-9._:-]{1,100}$/.test(requestId)) {
  throw new Error("SOURCING_LEARNING_REQUEST_ID is invalid");
}
if (confirmation !== `configure:${workspaceId}:${enabledText}:${expectedVersion}:${image}`) {
  throw new Error("SOURCING_LEARNING_CONFIRM does not match the exact configuration");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await supabase.rpc("configure_sourcing_learning", {
  p_workspace_id: workspaceId,
  p_actor_id: adminId,
  p_enabled: enabled,
  p_workspace_daily_limit: workspaceDailyLimit,
  p_user_daily_limit: userDailyLimit,
  p_min_evidence_runs: minimumEvidenceRuns,
  p_lesson_ttl_days: lessonTtlDays,
  p_required_graphify_image_digest: image,
  p_expected_version: expectedVersion,
  p_request_id: requestId,
});
if (error || data?.status !== "configured" || !Number.isSafeInteger(data?.version)) {
  throw new Error(`Sourcing-learning configuration was rejected: ${String(data?.status ?? "unknown")}`);
}
console.log(JSON.stringify({ status: "configured", enabled, version: data.version, image }));
