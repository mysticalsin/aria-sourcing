import http from "node:http";
import fs from "node:fs";

const HEALTH_SCHEMA = "aria.flowise-worker-readiness.v1";
const EVIDENCE_SCHEMA = "aria.flowise-worker-readiness-evidence.v1";
const DEFAULT_EVIDENCE_FILE = "/tmp/aria-flowise-worker-readiness.json";
const DEFAULT_MAX_AGE_MS = 15_000;
const QUEUE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const rawPort = process.env.WORKER_PORT ?? "5566";
if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) throw new Error("WORKER_PORT must be a valid TCP port");

const port = Number(rawPort);
if (!Number.isSafeInteger(port) || port > 65_535) throw new Error("WORKER_PORT must be a valid TCP port");

const rawMaxAge = process.env.ARIA_FLOWISE_WORKER_READINESS_MAX_AGE_MS ?? String(DEFAULT_MAX_AGE_MS);
if (!/^[1-9][0-9]{2,4}$/.test(rawMaxAge)) throw new Error("readiness max age is invalid");
const maxAgeMs = Number(rawMaxAge);
if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1_000 || maxAgeMs > 30_000) {
  throw new Error("readiness max age is invalid");
}

const queueName = process.env.QUEUE_NAME ?? "flowise-queue";
if (!QUEUE_NAME.test(queueName)) throw new Error("QUEUE_NAME is invalid");

const evidenceFile = process.env.ARIA_FLOWISE_WORKER_READINESS_FILE ?? DEFAULT_EVIDENCE_FILE;
if (!/^\/tmp\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(evidenceFile)) {
  throw new Error("readiness evidence path is invalid");
}

const supervisorPid = process.ppid;

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readWorkerEvidence(now = Date.now()) {
  let descriptor;
  try {
    descriptor = fs.openSync(evidenceFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_CLOEXEC);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 2 || stat.size > 4_096) return null;
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return null;
    if ((stat.mode & 0o077) !== 0) return null;

    const evidence = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    if (!exactKeys(evidence, ["schema", "observedAt", "workerPid", "queueName", "database", "workers"])) return null;
    if (evidence.schema !== EVIDENCE_SCHEMA || evidence.queueName !== queueName || evidence.database !== true) return null;
    if (!Number.isSafeInteger(evidence.observedAt) || evidence.observedAt > now || now - evidence.observedAt > maxAgeMs) return null;
    if (!Number.isSafeInteger(evidence.workerPid) || evidence.workerPid < 2 || !processIsAlive(evidence.workerPid)) return null;
    if (!Array.isArray(evidence.workers) || evidence.workers.length !== 3) return null;

    const expectedQueues = ["prediction", "upsertion", "schedule"].map((suffix) => `${queueName}-${suffix}`);
    for (let index = 0; index < expectedQueues.length; index += 1) {
      const worker = evidence.workers[index];
      if (!exactKeys(worker, ["queue", "id", "running", "redis"])) return null;
      if (
        worker.queue !== expectedQueues[index] ||
        !WORKER_ID.test(worker.id ?? "") ||
        worker.running !== true ||
        worker.redis !== true
      ) return null;
    }
    return evidence;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function sendJson(response, statusCode, body, headOnly) {
  const encoded = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": String(encoded.byteLength),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(headOnly ? undefined : encoded);
}

fs.rmSync(evidenceFile, { force: true });

const server = http.createServer((request, response) => {
  const methodAllowed = request.method === "GET" || request.method === "HEAD";
  if (!methodAllowed || request.url !== "/healthz") {
    response.writeHead(methodAllowed ? 404 : 405, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8"
    });
    response.end(methodAllowed ? "Not Found" : "Method Not Allowed");
    return;
  }

  const evidence = readWorkerEvidence();
  if (!evidence) {
    sendJson(response, 503, { schema: HEALTH_SCHEMA, status: "unavailable" }, request.method === "HEAD");
    return;
  }
  sendJson(response, 200, {
    schema: HEALTH_SCHEMA,
    status: "ready",
    queueName,
    database: true,
    queue: true,
    worker: true,
  }, request.method === "HEAD");
});

server.headersTimeout = 6_000;
server.keepAliveTimeout = 5_000;
server.requestTimeout = 5_000;
server.maxHeadersCount = 32;

server.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(port);

const parentMonitor = setInterval(() => {
  if (!processIsAlive(supervisorPid)) server.close(() => process.exit(1));
}, 1_000);
parentMonitor.unref();

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
