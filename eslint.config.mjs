import path from "node:path";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Flat-config migration of the old `.eslintrc.json` (next lint / legacy config are
// both removed in Next.js 16 — eslint-config-next now ships flat config only).
// Unlike `next lint`, plain `eslint .` under flat config does not read .gitignore by
// default, so gitignored build artifacts (e.g. a stray tmp/ NEXT_DIST_DIR output) would
// otherwise get linted — include the real .gitignore instead of duplicating its patterns.
const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".gitignore");

const config = [
  includeIgnoreFile(gitignorePath),
  ...nextCoreWebVitals,
  {
    ignores: [".localbin/**", "**/dist/**"],
  },
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      // eslint-plugin-react-hooks jumped to v7 as a transitive dep of eslint-config-next@16
      // and made its new "React Compiler readiness" rules errors-by-default. Those rules
      // (derived-state-sync effects, mutating a hook-returned three.js object, a stable
      // "latest value" ref written during render) flag ~20 existing, deliberate patterns
      // across the app. Fixing each one is a real per-site behavior review, not a mechanical
      // syntax change, so it's out of scope for a Next.js version bump — left as a distinct
      // follow-up hardening task rather than rewritten hastily here.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
    },
  },
];

export default config;
