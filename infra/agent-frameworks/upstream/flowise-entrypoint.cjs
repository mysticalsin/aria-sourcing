"use strict";

const fs = require("node:fs");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");

const COMMANDS = new Set(["start", "worker"]);
const SECRET = /^[A-Za-z0-9_-]{32,4096}$/;
const SECRET_BINDINGS = Object.freeze([
  ["FLOWISE_DATABASE_PASSWORD_FILE", "DATABASE_PASSWORD"],
  ["FLOWISE_REDIS_PASSWORD_FILE", "REDIS_PASSWORD"],
  ["FLOWISE_ENCRYPTION_KEY_FILE", "FLOWISE_SECRETKEY_OVERWRITE"],
  ["FLOWISE_JWT_AUTH_SECRET_FILE", "JWT_AUTH_TOKEN_SECRET"],
  ["FLOWISE_JWT_REFRESH_SECRET_FILE", "JWT_REFRESH_TOKEN_SECRET"],
  ["FLOWISE_SESSION_SECRET_FILE", "EXPRESS_SESSION_SECRET"],
  ["FLOWISE_TOKEN_HASH_SECRET_FILE", "TOKEN_HASH_SECRET"],
]);

function readSecret(fileVariable) {
  const file = process.env[fileVariable];
  if (typeof file !== "string" || !/^\/run\/secrets\/[a-z0-9_]{1,128}$/.test(file)) {
    throw new Error("Flowise secret file authority is invalid");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_CLOEXEC);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 32 || stat.size > 4097) throw new Error("Flowise secret file is invalid");
    const raw = fs.readFileSync(descriptor, "utf8");
    const value = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    if (!SECRET.test(value)) throw new Error("Flowise secret material is invalid");
    return value;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

const command = process.argv[2];
if (process.argv.length !== 3 || !COMMANDS.has(command)) throw new Error("Flowise command is invalid");
for (const [fileVariable, targetVariable] of SECRET_BINDINGS) {
  process.env[targetVariable] = readSecret(fileVariable);
}

let healthProcess;
let healthShutdownRequested = false;
if (command === "worker") {
  healthProcess = spawn(process.execPath, ["/opt/aria/flowise-worker-healthcheck.mjs"], {
    env: process.env,
    stdio: "inherit",
  });
  healthProcess.once("error", () => process.exit(1));
  healthProcess.once("exit", () => {
    if (!healthShutdownRequested) process.exit(1);
  });
}

function stopHealthProcess() {
  healthShutdownRequested = true;
  if (healthProcess?.exitCode === null) healthProcess.kill("SIGTERM");
}

const runFile = "/app/packages/server/bin/run";
process.chdir("/app/packages/server/bin");
process.argv = [process.execPath, runFile, command];
const oclif = createRequire(runFile)("@oclif/core");
oclif.run(undefined, "/app/packages/server")
  .then(oclif.flush)
  .then(stopHealthProcess)
  .catch((error) => {
    stopHealthProcess();
    return oclif.handle(error);
  });
