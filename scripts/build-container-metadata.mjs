import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const hash = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex");
const migrationNames = readdirSync("supabase/migrations").filter((name) => /^\d{4}_[A-Za-z0-9_]+\.sql$/.test(name)).sort();
if (!migrationNames.length) throw new Error("No numbered migrations found.");
const migrations = migrationNames.map((filename) => ({ filename, sha256: hash(readFileSync(join("supabase/migrations", filename))) }));
const ledger = migrations.map(({ filename, sha256 }) => `${filename}:${sha256}\n`).join("");
const sourceHash = createHash("sha1");
function fingerprint(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) fingerprint(file);
    else sourceHash.update(file.replaceAll("\\", "/")).update("\0").update(readFileSync(file));
  }
}
fingerprint("src");
fingerprint("scripts");
for (const file of ["Dockerfile", "next.config.mjs", "package.json", "tailwind.config.ts", "postcss.config.mjs"]) sourceHash.update(file).update("\0").update(readFileSync(file));
sourceHash.update(readFileSync("package-lock.json")).update(ledger);
const configuredRelease = process.env.ARIA_RELEASE_SHA;
if (configuredRelease && !/^[0-9a-f]{40}$/.test(configuredRelease)) throw new Error("ARIA_RELEASE_SHA must be a full commit SHA.");
const latest = migrations.at(-1);
writeFileSync("build-metadata.json", JSON.stringify({
  identityKind: configuredRelease ? "git-commit" : "local-source-fingerprint",
  environment: {
    ARIA_RELEASE_SHA: configuredRelease || sourceHash.digest("hex"),
    ARIA_EXPECTED_MIGRATION: latest.filename,
    ARIA_EXPECTED_MIGRATION_SHA: latest.sha256,
    ARIA_EXPECTED_MIGRATION_COUNT: String(migrations.length),
    ARIA_EXPECTED_LEDGER_SHA: hash(ledger),
  },
  publicConfig: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "",
    anonKeySha256: hash(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
  },
}, null, 2) + "\n");
