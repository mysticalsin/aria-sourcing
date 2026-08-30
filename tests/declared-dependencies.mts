import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import test from "node:test";

// Every external import in shipped code must resolve to a DECLARED dependency.
//
// A phantom dependency — imported directly but present only because some declared
// package happens to depend on it — builds green until that package upgrades or the
// lockfile is regenerated, then breaks a fresh clone. This exact class broke a clean
// build on 2026-07-24 (Floor3DScene importing a removed package), and recurred on
// 2026-07-26 (RetroOfficeScene importing three-stdlib, which only @react-three/drei
// pulled in). tests/isolated-build.mts cannot catch it: it string-matches the build
// script without building, and a populated node_modules masks the phantom.

const root = process.cwd();
const scannedRoots = ["src", "scripts"];

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const declared = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
]);
// `@types/foo` (and `@types/scope__name`) declare ambient types for `foo` / `@scope/name`.
for (const name of [...declared]) {
  if (!name.startsWith("@types/")) continue;
  const bare = name.slice("@types/".length);
  declared.add(bare.includes("__") ? `@${bare.replace("__", "/")}` : bare);
}

const builtins = new Set(builtinModules);

// Static import/export-from, side-effect import, require(), dynamic import(), and
// ambient `declare module "pkg"`.
//
// The lookbehinds keep flag strings like "--import" and property accesses out: `-` sits
// on a word boundary, so a bare \bimport matches inside "--import" and reads the
// following array element as a module spec.
//
// `[^;'"]*?` on the from-clause deliberately allows comments and import attributes
// between the clause and the specifier (`from /* c */ "pkg"`, `import("pkg", { with: … })`),
// which an earlier version missed.
const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/)*`;
const NB = String.raw`(?<![\w$.-])`;
// Static import/export-from, side-effect import, require(), dynamic import(), and ambient
// `declare module "pkg"`. Only whitespace and block comments may sit between a clause and
// its specifier -- an earlier attempt allowed arbitrary text there and matched quoted
// strings from unrelated statements many lines away.
//
// The NB lookbehind keeps flag strings like "--import" out: `-` sits on a word boundary,
// so a bare \bimport matches inside "--import" and reads the next array element as a spec.
//
// `import("pkg", { with: … })` needs no special handling: the specifier comes first.
const importSpecPattern = new RegExp(
  [
    `(?:${NB}import|${NB}export)[^;'"]*?\\bfrom${GAP}["']([^"']+)["']`,
    `${NB}import${GAP}["']([^"']+)["']`,
    `${NB}require\\(${GAP}["']([^"']+)["']`,
    `${NB}import\\(${GAP}["']([^"']+)["']`,
    `${NB}declare\\s+module${GAP}["']([^"']+)["']`,
  ].join("|"),
  "g",
);

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    const rel = relative(root, join(root, dir, entry));
    if (statSync(join(root, rel)).isDirectory()) return walk(rel);
    return /\.(?:ts|tsx|mts|mjs|js)$/.test(entry) ? [rel] : [];
  });
}

function basePackage(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

test("every external import in src/ and scripts/ resolves to a declared dependency", () => {
  const offenders = new Map<string, string[]>();
  for (const file of scannedRoots.flatMap((dir) => walk(dir))) {
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(importSpecPattern)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
      if (!spec) continue;
      // Relative paths, the @/ alias, and URL-ish specs are not packages.
      if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("~/")) continue;
      if (spec.startsWith("node:") || spec.includes("://")) continue;
      const base = basePackage(spec);
      if (builtins.has(base) || declared.has(base)) continue;
      const files = offenders.get(base) ?? [];
      if (!files.includes(file)) files.push(file);
      offenders.set(base, files);
    }
  }
  assert.deepEqual(
    [...offenders.entries()].map(([pkg, files]) => `${pkg} <- ${files.join(", ")}`).sort(),
    [],
  );
});
