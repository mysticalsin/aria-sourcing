/**
 * p95 of Michael's TypeScript scorer on the same 500 synthetic candidates.
 * No network. Prints one JSON object.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "aria-ts-bench-"));
function rewrite(src) {
  return src
    .replaceAll('from "./utils"', 'from "./utils.ts"')
    .replaceAll('from "./geo-europe"', 'from "./geo-europe.ts"')
    .replaceAll('from "./types"', 'from "./types.ts"');
}
writeFileSync(
  join(dir, "utils.ts"),
  `export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
export function round(n, dp = 0) { const f = 10 ** dp; return Math.round(n * f) / f; }
`,
);
writeFileSync(join(dir, "types.ts"), "export type Candidate = any;\nexport type JobAnalysis = any;\nexport type ScoringWeights = any;\n");
writeFileSync(join(dir, "geo-europe.ts"), rewrite(readFileSync(join(root, "src/lib/geo-europe.ts"), "utf8")));
writeFileSync(join(dir, "scoring.ts"), rewrite(readFileSync(join(root, "src/lib/scoring.ts"), "utf8")));
const { scoreCandidate, DEFAULT_SCORING_WEIGHTS } = await import(pathToFileURL(join(dir, "scoring.ts")).href);
const fixture = JSON.parse(readFileSync(join(root, "core/fixtures/scoring-vectors.json"), "utf8"));
const job = fixture.batch500.job;
const candidates = fixture.batch500.candidates;
for (let i = 0; i < 5; i++) {
  for (const candidate of candidates) scoreCandidate(candidate, job, DEFAULT_SCORING_WEIGHTS);
}
const iterations = 30;
const samples = [];
for (let i = 0; i < iterations; i++) {
  const start = process.hrtime.bigint();
  for (const candidate of candidates) scoreCandidate(candidate, job, DEFAULT_SCORING_WEIGHTS);
  samples.push(Number(process.hrtime.bigint() - start));
}
samples.sort((a, b) => a - b);
const index = Math.ceil(samples.length * 0.95) - 1;
const p50 = samples[Math.floor(samples.length / 2)];
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({
  name: "ts_score_batch_500_p95",
  unit: "ns",
  value: samples[index],
  p50_ns: p50,
  iterations,
}));
