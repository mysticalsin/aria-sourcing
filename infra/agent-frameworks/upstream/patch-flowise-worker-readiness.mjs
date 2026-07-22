#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";

const PINNED_COMMIT = "ed9e100fb71643cd3922b005908f9732bc0e07dc";
const EXPECTED_INPUT_SHA256 = "c1bd833235bcfde0fc1593a9a2cb49bce4e6c5e5fe9a9fc0d1435946223eced4";
const EXPECTED_OUTPUT_SHA256 = "47f2efd0187dc104ac112a05eb13af60f072e43f4d6e51a122c470ed271f75cb";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Pinned Flowise ${label} anchor drifted`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

const target = process.argv[2];
if (!target) throw new Error("usage: patch-flowise-worker-readiness.mjs WORKER_TS");

const input = fs.readFileSync(target);
if (sha256(input) !== EXPECTED_INPUT_SHA256) {
  throw new Error(`Flowise worker source does not match pinned commit ${PINNED_COMMIT}`);
}

let output = input.toString("utf8");
output = replaceExactlyOnce(
  output,
  "import logger from '../utils/logger'\n",
  "import { rename, rm, writeFile } from 'node:fs/promises'\nimport logger from '../utils/logger'\n",
  "imports",
);
output = replaceExactlyOnce(
  output,
  "    scheduleWorkerId: string\n",
  "    scheduleWorkerId: string\n    readinessInterval?: NodeJS.Timeout\n    readinessRefreshInProgress = false\n    readinessStopping = false\n",
  "class fields",
);
output = replaceExactlyOnce(
  output,
  `        this.scheduleWorkerId = scheduleWorker.id
        logger.info(\`Schedule Worker \${this.scheduleWorkerId} created\`)

        // Keep the process running
`,
  `        this.scheduleWorkerId = scheduleWorker.id
        logger.info(\`Schedule Worker \${this.scheduleWorkerId} created\`)

        const readinessFile = process.env.ARIA_FLOWISE_WORKER_READINESS_FILE || '/tmp/aria-flowise-worker-readiness.json'
        if (!/^\\/tmp\\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(readinessFile)) {
            throw new Error('worker readiness path is invalid')
        }
        const readinessWorkers = [
            { queue: predictionQueueName, worker: predictionWorker },
            { queue: upsertionQueue.getQueueName(), worker: upsertionWorker },
            { queue: scheduleQueue.getQueueName(), worker: scheduleWorker }
        ]
        const refreshReadiness = async () => {
            if (this.readinessRefreshInProgress || this.readinessStopping) return
            this.readinessRefreshInProgress = true
            const temporaryFile = \`\${readinessFile}.\${process.pid}.tmp\`
            try {
                const clients = await Promise.all(readinessWorkers.map(({ worker }) => worker.client))
                const blockingClients = await Promise.all(readinessWorkers.map(({ worker }) => worker.waitUntilReady()))
                if (
                    readinessWorkers.some(({ worker }) => !worker.isRunning()) ||
                    [...clients, ...blockingClients].some((client) => client.status !== 'ready')
                ) {
                    throw new Error('worker queue connection is not ready')
                }
                await Promise.all(clients.map((client) => client.ping()))
                await appDataSource.query('SELECT 1')
                if (this.readinessStopping) throw new Error('worker is stopping')
                const evidence = {
                    schema: 'aria.flowise-worker-readiness-evidence.v1',
                    observedAt: Date.now(),
                    workerPid: process.pid,
                    queueName: process.env.QUEUE_NAME || 'flowise-queue',
                    database: true,
                    workers: readinessWorkers.map(({ queue, worker }) => ({
                        queue,
                        id: worker.id,
                        running: worker.isRunning(),
                        redis: true
                    }))
                }
                await writeFile(temporaryFile, \`\${JSON.stringify(evidence)}\\n\`, { encoding: 'utf8', mode: 0o600 })
                if (this.readinessStopping) throw new Error('worker is stopping')
                await rename(temporaryFile, readinessFile)
            } catch {
                await rm(temporaryFile, { force: true }).catch(() => undefined)
                await rm(readinessFile, { force: true }).catch(() => undefined)
                logger.warn('Flowise worker readiness evidence unavailable')
            } finally {
                this.readinessRefreshInProgress = false
            }
        }

        await rm(readinessFile, { force: true })
        await refreshReadiness()
        this.readinessInterval = setInterval(() => void refreshReadiness(), 5000)
        this.readinessInterval.unref()

        // Keep the process running
`,
  "worker startup",
);
output = replaceExactlyOnce(
  output,
  "    async stopProcess() {\n        try {\n",
  `    async stopProcess() {
        this.readinessStopping = true
        if (this.readinessInterval) clearInterval(this.readinessInterval)
        const readinessFile = process.env.ARIA_FLOWISE_WORKER_READINESS_FILE || '/tmp/aria-flowise-worker-readiness.json'
        await rm(readinessFile, { force: true }).catch(() => undefined)
        try {
`,
  "worker shutdown",
);

const encoded = Buffer.from(output, "utf8");
if (sha256(encoded) !== EXPECTED_OUTPUT_SHA256) {
  throw new Error("Patched Flowise worker output hash is not approved");
}
fs.writeFileSync(target, encoded);
