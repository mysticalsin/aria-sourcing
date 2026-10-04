#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const GRAPHIFY_COMMIT = "94d3099540550d58dd121ec3e67cf93e80364079";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/i;

function required(name, fallback = "") {
  const value = (process.env[name] ?? fallback).trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const row = object(value);
  if (!row) return value;
  return Object.fromEntries(
    Object.keys(row).sort().map((key) => [key, canonicalValue(row[key])]),
  );
}

function validateExport(value) {
  const root = object(value);
  const payload = object(root?.payload);
  if (
    root?.status !== "exported" ||
    payload?.schemaVersion !== 1 ||
    typeof payload.workspaceFingerprint !== "string" ||
    !SHA256_RE.test(payload.workspaceFingerprint) ||
    !Array.isArray(payload.lessons) ||
    payload.lessons.length > 500
  ) {
    throw new Error("Sourcing-learning export receipt is invalid");
  }
  for (const lesson of payload.lessons) {
    const row = object(lesson);
    if (
      !row ||
      !UUID_RE.test(String(row.lessonId ?? "")) ||
      !Number.isSafeInteger(row.authorityVersion) ||
      row.authorityVersion < 1 ||
      !SHA256_RE.test(String(row.roleFingerprint ?? "")) ||
      !SHA256_RE.test(String(row.queryFingerprint ?? ""))
    ) {
      throw new Error("Sourcing-learning export contains an invalid lesson authority");
    }
  }
  const exportId = root?.exportId;
  if (payload.lessons.length > 0 && !UUID_RE.test(String(exportId ?? ""))) {
    throw new Error("Sourcing-learning export authority is missing");
  }
  return { payload, exportId: payload.lessons.length > 0 ? exportId : null };
}

function validateManifest(value, payload) {
  const manifest = object(value);
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.inputSchemaVersion !== 1 ||
    manifest?.workspaceFingerprint !== payload.workspaceFingerprint ||
    manifest?.lessonCount !== payload.lessons.length ||
    !SHA256_RE.test(String(manifest?.graphSha256 ?? "")) ||
    object(manifest?.graphify)?.commit !== GRAPHIFY_COMMIT ||
    object(manifest?.graphify)?.semanticLlmUsed !== false ||
    object(manifest?.graphify)?.queryLoggingDisabled !== true ||
    !Array.isArray(manifest?.attachments) ||
    manifest.attachments.length !== payload.lessons.length
  ) {
    throw new Error("Graphify manifest is invalid");
  }
  const expected = new Map(
    payload.lessons.map((lesson) => [lesson.lessonId, lesson.authorityVersion]),
  );
  for (const attachment of manifest.attachments) {
    const row = object(attachment);
    if (
      !row ||
      !UUID_RE.test(String(row.lessonId ?? "")) ||
      expected.get(row.lessonId) !== row.expectedVersion ||
      typeof row.clusterRef !== "string" ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(row.clusterRef)
    ) {
      throw new Error("Graphify attachment receipt is invalid");
    }
  }
  return manifest;
}

function validateGraph(graphText, manifest) {
  let graph;
  try {
    graph = JSON.parse(graphText);
  } catch {
    throw new Error("Graphify graph is invalid JSON");
  }
  const row = object(graph);
  const graphSha256 = createHash("sha256").update(graphText).digest("hex");
  if (
    !row ||
    row.built_at_commit !== GRAPHIFY_COMMIT ||
    row.directed !== true ||
    graphSha256 !== manifest.graphSha256
  ) {
    throw new Error("Graphify graph does not match its manifest");
  }
  return graphSha256;
}

const supabaseUrl = required(
  "SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
);
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const workspaceId = required("SOURCING_LEARNING_WORKSPACE_ID");
const adminId = required("SOURCING_LEARNING_ADMIN_ID");
const image = required("GRAPHIFY_LESSONS_IMAGE");
if (!UUID_RE.test(workspaceId) || !UUID_RE.test(adminId)) {
  throw new Error("Sourcing-learning workspace and admin IDs must be UUIDs");
}
if (!IMAGE_RE.test(image)) {
  throw new Error("GRAPHIFY_LESSONS_IMAGE must be pinned by sha256 digest");
}
const parsedLimit = Number.parseInt(process.env.SOURCING_LEARNING_LIMIT ?? "100", 10);
if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
  throw new Error("SOURCING_LEARNING_LIMIT must be between 1 and 500");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: exported, error: exportError } = await supabase.rpc(
  "export_graphify_sourcing_lessons",
  {
    p_workspace_id: workspaceId,
    p_actor_id: adminId,
    p_limit: parsedLimit,
  },
);
if (exportError) throw new Error("Sourcing-learning export failed");
if (object(exported)?.status === "learning_disabled") {
  console.log(JSON.stringify({ status: "learning_disabled" }));
  process.exit(0);
}
const { payload, exportId } = validateExport(exported);
if (payload.lessons.length === 0) {
  console.log(JSON.stringify({ status: "no_eligible_lessons" }));
  process.exit(0);
}

const work = await mkdtemp(join(tmpdir(), "aria-graphify-lessons-"));
try {
  await chmod(work, 0o700);
  const inputPath = join(work, "input.json");
  const outputPath = join(work, "output");
  await mkdir(outputPath, { mode: 0o777 });
  const inputText = JSON.stringify(canonicalValue(payload));
  await writeFile(inputPath, `${inputText}\n`, { mode: 0o600 });

  const run = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "64",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--volume",
      `${inputPath}:/data/input.json:ro`,
      "--volume",
      `${outputPath}:/data/output:rw`,
      image,
    ],
    { stdio: "inherit", timeout: 10 * 60 * 1000 },
  );
  if (run.error || run.status !== 0) throw new Error("Graphify worker failed");

  const manifest = validateManifest(
    JSON.parse(await readFile(join(outputPath, "manifest.json"), "utf8")),
    payload,
  );
  const graphText = await readFile(join(outputPath, "graph.json"), "utf8");
  const graphSha256 = validateGraph(graphText, manifest);
  const { data: completedExport, error: completionError } = await supabase.rpc(
    "complete_graphify_sourcing_export",
    {
      p_workspace_id: workspaceId,
      p_actor_id: adminId,
      p_export_id: exportId,
      p_input_text: inputText,
      p_graph_text: graphText,
      p_manifest: manifest,
      p_image_digest: image,
    },
  );
  if (
    completionError ||
    object(completedExport)?.status !== "completed" ||
    object(completedExport)?.exportId !== exportId ||
    object(completedExport)?.graphSha256 !== graphSha256
  ) {
    throw new Error("Graphify artifact persistence failed");
  }
  for (const attachment of manifest.attachments) {
    const { data, error } = await supabase.rpc("attach_graphify_sourcing_lesson", {
      p_workspace_id: workspaceId,
      p_actor_id: adminId,
      p_lesson_id: attachment.lessonId,
      p_expected_version: attachment.expectedVersion,
      p_export_id: exportId,
    });
    if (error || object(data)?.status !== "attached") {
      throw new Error(`Graphify attachment failed for lesson ${attachment.lessonId}`);
    }
  }
  console.log(
    JSON.stringify({
      status: "attached_for_human_review",
      lessonCount: payload.lessons.length,
      graphSha256,
      exportId,
      graphifyCommit: GRAPHIFY_COMMIT,
    }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
