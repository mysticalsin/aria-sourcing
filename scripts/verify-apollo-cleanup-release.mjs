import { pathToFileURL } from "node:url";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const COUNTERS = [
  "workspacesProcessed",
  "processed",
  "expired_receipts_cleared",
  "confirmations_deleted",
  "targets_deleted",
  "expired_targets_scrubbed",
  "quota_rows_deleted",
];

export function verifyCleanupProcessGroups(raw, expectedDigest) {
  if (!DIGEST_RE.test(expectedDigest)) throw new Error("invalid expected image digest");
  let machines;
  try {
    machines = JSON.parse(raw);
  } catch {
    throw new Error("invalid Fly machine inventory");
  }
  if (!Array.isArray(machines) || machines.length < 2) {
    throw new Error("incomplete Fly machine inventory");
  }

  const groups = { web: [], cleanup: [] };
  for (const machine of machines) {
    const id = typeof machine?.id === "string" ? machine.id : "";
    const group = machine?.config?.metadata?.fly_process_group;
    const image = typeof machine?.image_ref === "string"
      ? machine.image_ref
      : typeof machine?.config?.image === "string"
        ? machine.config.image
        : "";
    if (!id || (group !== "web" && group !== "cleanup")) {
      throw new Error("unexpected Fly application process group");
    }
    if (!image.includes(expectedDigest)) throw new Error(`${group} process image digest mismatch`);
    groups[group].push({ id, state: machine.state, standbys: machine?.config?.standbys });
  }
  if (!groups.web.some((machine) => machine.state === "started")) {
    throw new Error("web process group has no started machine");
  }
  const activeCleanup = groups.cleanup.filter((machine) => machine.state === "started");
  if (activeCleanup.length !== 1) throw new Error("cleanup process group must have one active cleanup machine");
  const standbyCleanup = groups.cleanup.filter((machine) =>
    machine.state === "stopped" &&
    Array.isArray(machine.standbys) &&
    machine.standbys.includes(activeCleanup[0].id),
  );
  if (groups.cleanup.length !== 2 || standbyCleanup.length !== 1) {
    throw new Error("cleanup process group must have one paired standby machine");
  }
  return activeCleanup[0].id;
}

export function verifyHealthyCleanupEvent(raw, expectedReleaseSha, notBefore) {
  if (!/^[0-9a-f]{40}$/.test(expectedReleaseSha)) return false;
  const lowerBound = Date.parse(notBefore);
  if (!Number.isFinite(lowerBound)) return false;
  const healthy = (event) =>
    event?.event === "apollo_authority_cleanup" &&
    event.status === "ok" &&
    event.releaseSha === expectedReleaseSha &&
    Number.isFinite(Date.parse(event.startedAt)) &&
    Date.parse(event.startedAt) >= lowerBound &&
    COUNTERS.every((key) => Number.isSafeInteger(event[key]) && event[key] >= 0);
  const eventFrom = (value, depth = 0) => {
    if (depth > 2) return null;
    if (value && typeof value === "object") {
      if (value.event === "apollo_authority_cleanup") return value;
      for (const key of ["message", "msg"]) {
        if (typeof value[key] === "string") {
          const nested = eventFrom(value[key], depth + 1);
          if (nested) return nested;
        }
      }
      return null;
    }
    if (typeof value !== "string") return null;
    try {
      const parsed = JSON.parse(value);
      const nested = eventFrom(parsed, depth + 1);
      if (nested) return nested;
    } catch {
      // Fly's human log format prefixes the application JSON receipt.
    }
    const start = value.indexOf('{"event":"apollo_authority_cleanup"');
    if (start < 0) return null;
    try {
      return JSON.parse(value.slice(start));
    } catch {
      return null;
    }
  };

  for (const line of raw.split(/\r?\n/)) {
    if (healthy(eventFrom(line))) return true;
  }
  return false;
}

async function main() {
  const mode = process.argv[2];
  const expectedDigest = process.argv[3] ?? "";
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (mode === "machines") {
    process.stdout.write(`${verifyCleanupProcessGroups(raw, expectedDigest)}\n`);
    return;
  }
  if (mode === "logs" && verifyHealthyCleanupEvent(raw, expectedDigest, process.argv[4] ?? "")) return;
  throw new Error("healthy Apollo cleanup release evidence is absent");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "cleanup release verification failed");
    process.exitCode = 1;
  });
}
