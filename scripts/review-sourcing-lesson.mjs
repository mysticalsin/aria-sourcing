#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISIONS = new Set(["promoted", "suspended", "retired"]);
const REASONS = new Set([
  "reviewed_useful",
  "quality_hold",
  "security_hold",
  "operator_disabled",
  "expired",
  "superseded",
]);

function required(name, fallback = "") {
  const value = (process.env[name] ?? fallback).trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const supabaseUrl = required(
  "SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
);
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const workspaceId = required("SOURCING_LEARNING_WORKSPACE_ID");
const reviewerId = required("SOURCING_LEARNING_ADMIN_ID");
const lessonId = required("SOURCING_LESSON_ID");
const decision = required("SOURCING_LESSON_DECISION");
const reason = required("SOURCING_LESSON_REASON");
const requestId = required("SOURCING_LESSON_REQUEST_ID");
const expectedVersion = Number.parseInt(required("SOURCING_LESSON_EXPECTED_VERSION"), 10);
const confirmation = required("SOURCING_LEARNING_CONFIRM");

if (![workspaceId, reviewerId, lessonId].every((value) => UUID_RE.test(value))) {
  throw new Error("Workspace, reviewer, and lesson IDs must be UUIDs");
}
if (!DECISIONS.has(decision) || !REASONS.has(reason)) {
  throw new Error("Lesson decision or reason is invalid");
}
if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
  throw new Error("SOURCING_LESSON_EXPECTED_VERSION must be a positive integer");
}
if (!/^[A-Za-z0-9._:-]{1,100}$/.test(requestId)) {
  throw new Error("SOURCING_LESSON_REQUEST_ID is invalid");
}
if (confirmation !== `review:${lessonId}:${decision}:${expectedVersion}`) {
  throw new Error("SOURCING_LEARNING_CONFIRM does not match the exact review operation");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await supabase.rpc("review_sourcing_lesson", {
  p_workspace_id: workspaceId,
  p_reviewer_id: reviewerId,
  p_lesson_id: lessonId,
  p_expected_version: expectedVersion,
  p_decision: decision,
  p_reason_code: reason,
  p_request_id: requestId,
});
if (error) throw new Error("Sourcing lesson review failed");
if (data?.status !== "reviewed" || !Number.isSafeInteger(data?.version)) {
  throw new Error(`Sourcing lesson review was rejected: ${String(data?.status ?? "unknown")}`);
}
console.log(JSON.stringify({ status: "reviewed", lessonId, decision, version: data.version }));
