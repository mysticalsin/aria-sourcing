#!/usr/bin/env node
import process from "node:process";

import { deriveAgentFrameworkConfigurationFromEnvironment } from "../src/lib/agents/framework/configuration-core.mjs";

try {
  const derived = deriveAgentFrameworkConfigurationFromEnvironment(process.env);
  if (process.argv.includes("--sha-only")) {
    process.stdout.write(`${derived.sha256}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ manifest: derived.manifest, sha256: derived.sha256 }, null, 2)}\n`);
  }
} catch {
  process.stderr.write("Agent framework configuration is incomplete or invalid.\n");
  process.exitCode = 1;
}
