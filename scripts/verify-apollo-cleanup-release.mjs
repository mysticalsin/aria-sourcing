import { pathToFileURL } from "node:url";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const PROCESS_GROUPS = ["web", "cleanup", "framework_heartbeat", "loop"];
const COUNTERS = [
  "workspacesProcessed",
  "processed",
  "expired_receipts_cleared",
  "confirmations_deleted",
  "targets_deleted",
  "expired_targets_scrubbed",
  "quota_rows_deleted",
  "sourcing_lessons_retired",
  "sourcing_lessons_deleted",
  "sourcing_artifacts_deleted",
  "sourcing_runs_deleted",
  "sourcing_quota_rows_deleted",
  "framework_authorizations_deleted",
];

function imageHasExactDigest(image, expectedDigest) {
  const separator = image.lastIndexOf("@");
  return (separator < 0 ? image : image.slice(separator + 1)) === expectedDigest;
}

function activeWithStandby(machines, group) {
  const active = machines.filter((machine) => machine.state === "started");
  if (active.length !== 1) {
    const qualifier = group === "cleanup" ? " cleanup" : "";
    throw new Error(`${group} process group must have one active${qualifier} machine`);
  }
  const standby = machines.filter((machine) =>
    machine.state === "stopped" &&
    Array.isArray(machine.standbys) &&
    machine.standbys.length === 1 &&
    machine.standbys[0] === active[0].id,
  );
  if (machines.length !== 2 || standby.length !== 1) {
    throw new Error(`${group} process group must have one paired standby machine`);
  }
  return active[0].id;
}

function requireGroupPresent(machines, group) {
  if (machines.length === 0) {
    throw new Error(`${group} process group has no machine`);
  }
}

export function verifyReleaseProcessGroups(raw, expectedDigest) {
  if (!DIGEST_RE.test(expectedDigest)) throw new Error("invalid expected image digest");
  let machines;
  try {
    machines = JSON.parse(raw);
  } catch {
    throw new Error("invalid Fly machine inventory");
  }
  if (!Array.isArray(machines) || machines.length === 0) {
    throw new Error("incomplete Fly machine inventory");
  }

  const groups = { web: [], cleanup: [], framework_heartbeat: [], loop: [] };
  const machineIds = new Set();
  for (const machine of machines) {
    const id = typeof machine?.id === "string" ? machine.id : "";
    const group = machine?.config?.metadata?.fly_process_group;
    const image = typeof machine?.image_ref === "string"
      ? machine.image_ref
      : typeof machine?.config?.image === "string"
        ? machine.config.image
        : "";
    if (!id || !PROCESS_GROUPS.includes(group)) {
      throw new Error("unexpected Fly application process group");
    }
    if (machineIds.has(id)) throw new Error("duplicate Fly machine identifier");
    machineIds.add(id);
    if (!imageHasExactDigest(image, expectedDigest)) {
      throw new Error(`${group} process image digest mismatch`);
    }
    groups[group].push({ id, state: machine.state, standbys: machine?.config?.standbys });
  }
  if (!groups.web.some((machine) => machine.state === "started")) {
    throw new Error("web process group has no started machine");
  }
  requireGroupPresent(groups.loop, "loop");
  return {
    cleanupMachineId: activeWithStandby(groups.cleanup, "cleanup"),
    frameworkHeartbeatMachineId: activeWithStandby(groups.framework_heartbeat, "framework_heartbeat"),
  };
}

export function verifyCleanupProcessGroups(raw, expectedDigest) {
  return verifyReleaseProcessGroups(raw, expectedDigest).cleanupMachineId;
}

function eventFrom(value, eventName, inheritedTimestamp = "", depth = 0) {
  if (depth > 3) return null;
  if (value && typeof value === "object") {
    const timestamp = typeof value.startedAt === "string"
      ? value.startedAt
      : typeof value.timestamp === "string"
        ? value.timestamp
        : inheritedTimestamp;
    if (value.event === eventName) return { event: value, timestamp };
    for (const key of ["message", "msg"]) {
      if (typeof value[key] === "string" || (value[key] && typeof value[key] === "object")) {
        const nested = eventFrom(value[key], eventName, timestamp, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    const nested = eventFrom(parsed, eventName, inheritedTimestamp, depth + 1);
    if (nested) return nested;
  } catch {
    // Fly's human log format can prefix the application JSON receipt.
  }
  const start = value.indexOf(`{"event":"${eventName}"`);
  if (start < 0) return null;
  try {
    return eventFrom(JSON.parse(value.slice(start)), eventName, inheritedTimestamp, depth + 1);
  } catch {
    return null;
  }
}

function logHasEvent(raw, eventName, healthy) {
  for (const line of raw.split(/\r?\n/)) {
    const receipt = eventFrom(line, eventName);
    if (receipt && healthy(receipt)) return true;
  }
  return false;
}

export function verifyHealthyCleanupEvent(raw, expectedReleaseSha, notBefore) {
  if (!RELEASE_SHA_RE.test(expectedReleaseSha)) return false;
  const lowerBound = Date.parse(notBefore);
  if (!Number.isFinite(lowerBound)) return false;
  return logHasEvent(raw, "apollo_authority_cleanup", ({ event }) =>
    event?.event === "apollo_authority_cleanup" &&
    event.status === "ok" &&
    event.releaseSha === expectedReleaseSha &&
    Number.isFinite(Date.parse(event.startedAt)) &&
    Date.parse(event.startedAt) >= lowerBound &&
    COUNTERS.every((key) => Number.isSafeInteger(event[key]) && event[key] >= 0),
  );
}

export function verifyHealthyFrameworkHeartbeatEvent(raw, expectedReleaseSha, notBefore) {
  if (!RELEASE_SHA_RE.test(expectedReleaseSha)) return false;
  const lowerBound = Date.parse(notBefore);
  if (!Number.isFinite(lowerBound)) return false;
  return logHasEvent(raw, "agent_framework_heartbeat", ({ event, timestamp }) =>
    event?.event === "agent_framework_heartbeat" &&
    event.status === "ok" &&
    event.releaseSha === expectedReleaseSha &&
    Number.isFinite(Date.parse(timestamp)) &&
    Date.parse(timestamp) >= lowerBound &&
    Number.isSafeInteger(event.targets) &&
    event.targets >= 2 &&
    event.targets <= 500 &&
    event.ready === event.targets &&
    event.recorded === event.targets &&
    Array.isArray(event.failureCodes) &&
    event.failureCodes.length === 0 &&
    Number.isSafeInteger(event.durationMs) &&
    event.durationMs >= 0,
  );
}

async function main() {
  const mode = process.argv[2];
  const expectedDigest = process.argv[3] ?? "";
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (mode === "machines") {
    process.stdout.write(`${JSON.stringify(verifyReleaseProcessGroups(raw, expectedDigest))}\n`);
    return;
  }
  if (mode === "logs" && verifyHealthyCleanupEvent(raw, expectedDigest, process.argv[4] ?? "")) return;
  if (mode === "heartbeat-logs" && verifyHealthyFrameworkHeartbeatEvent(raw, expectedDigest, process.argv[4] ?? "")) return;
  if (mode === "heartbeat-logs") throw new Error("healthy agent framework heartbeat release evidence is absent");
  throw new Error("healthy Apollo cleanup release evidence is absent");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "cleanup release verification failed");
    process.exitCode = 1;
  });
}
