import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SECRET = /^[A-Za-z0-9_-]{32,4096}$/;

export function validateSecretFiles(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || new Set(paths).size !== paths.length) {
    throw new Error("secret preflight file list is invalid");
  }
  const values = paths.map((file) => {
    const raw = fs.readFileSync(file, "utf8");
    const value = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    if (!SECRET.test(value)) throw new Error("a required secret is empty, short, or not base64url");
    return value;
  });
  if (new Set(values).size !== values.length) throw new Error("required secrets must not be reused");
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = String(process.env.SECRET_PREFLIGHT_FILES ?? "").split(",").filter(Boolean);
  validateSecretFiles(paths);
  console.log(`validated ${paths.length} independent secret files`);
}
