import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

function validKey(key) {
  return typeof key === "string" && Buffer.from(key, "base64").length === 32 && Buffer.from(key, "base64").toString("base64") === key;
}

export function configureContainerRuntime({ env = process.env, configDirectory = "/app/config", metadataPath = "/app/build-metadata.json", development = false } = {}) {
  if (!development) {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  for (const [name, value] of Object.entries(metadata.environment)) {
    if (env[name] && env[name] !== value) throw new Error(`Image identity mismatch for ${name}; rebuild the image.`);
    env[name] = value;
  }
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"]) {
    if (env[name] !== metadata.publicConfig[name]) throw new Error(`Build/runtime mismatch for ${name}; rebuild with the intended public URL.`);
  }
  if (createHash("sha256").update(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").digest("hex") !== metadata.publicConfig.anonKeySha256) {
    throw new Error("Build/runtime mismatch for the public Supabase key; rebuild the image.");
  }
  }
  const keyPath = resolve(configDirectory, "data-encryption-key");
  const storedKey = existsSync(keyPath) ? readFileSync(keyPath, "utf8").trim() : undefined;
  if (storedKey !== undefined && !validKey(storedKey)) throw new Error("Stored encryption key is invalid; preserve the volume and restore its key.");
  if (env.DATA_ENCRYPTION_KEY) {
    if (!validKey(env.DATA_ENCRYPTION_KEY)) throw new Error("DATA_ENCRYPTION_KEY must be canonical base64 encoding 32 bytes.");
    if (storedKey && storedKey !== env.DATA_ENCRYPTION_KEY) throw new Error("Encryption key differs from the persisted local key; use the documented key rotation procedure.");
    return;
  }
  if (env.ARIA_LOCAL_DEMO !== "true") throw new Error("DATA_ENCRYPTION_KEY is required outside the local Docker demo.");
  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
  if (appUrl.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(appUrl.hostname)) throw new Error("Local key generation requires a loopback HTTP app URL.");
  mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  if (!storedKey) {
    try { writeFileSync(keyPath, randomBytes(32).toString("base64") + "\n", { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const key = readFileSync(keyPath, "utf8").trim();
  if (!validKey(key)) throw new Error("Persisted encryption key is invalid; do not recreate it over encrypted data.");
  env.DATA_ENCRYPTION_KEY = key;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const development = process.argv.includes("--development");
  configureContainerRuntime({ development });
  if (development) {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0"], { stdio: "inherit" });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
    child.on("error", () => { process.exitCode = 1; });
  } else await import(pathToFileURL(resolve("server.js")).href);
}
