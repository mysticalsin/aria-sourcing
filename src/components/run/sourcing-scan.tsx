import type { PublicSourcingJob } from "@/lib/sourcing/unified-contract";
import { SOURCE_LABELS } from "@/lib/sourcing/unified-contract";

/** The running-search moment, in the login's visual language: a field of
 *  profiles, a violet sweep that keeps crossing it and lights the matches as
 *  it passes. Pure CSS, loops while a step is in flight; reduced motion drops
 *  the sweep and shows the lit field still. The step list below carries the
 *  meaning for assistive technology, so the field itself is decorative. */

const COLS = 34;
const ROWS = 6;
const W = 680;
const H = 120;
const PERIOD = 2.8; // seconds, kept in sync with .sourcing-scan-* in globals.css

type Dot = { x: number; y: number; match: boolean; delay: number };

/** Deterministic pseudo-random, so the field does not reshuffle on re-render. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const DOTS: Dot[] = (() => {
  const random = rng(11);
  const dots: Dot[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = ((c + 0.5) / COLS) * W + (random() - 0.5) * 10;
      const y = ((r + 0.5) / ROWS) * H + (random() - 0.5) * 10;
      // The sweep band (20% wide) travels from -20% to 100% over PERIOD:
      // its centre crosses x at (x/W + 0.1) / 1.2 of the period.
      dots.push({ x, y, match: random() < 0.09, delay: (PERIOD * (x / W + 0.1)) / 1.2 });
    }
  }
  return dots;
})();

export function SourcingScan({ job }: { job: PublicSourcingJob }) {
  const step = job.steps.find((s) => ["queued", "starting", "running"].includes(s.status));
  if (!step) return null;
  const found = job.steps.reduce((sum, s) => sum + s.found, 0);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink text-paper animate-fade-in">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="block h-28 w-full" aria-hidden>
        {DOTS.map((d, i) => d.match
          ? <circle key={i} cx={d.x} cy={d.y} r={3.2} className="sourcing-scan-match" style={{ animationDelay: `${d.delay.toFixed(2)}s` }} />
          : <circle key={i} cx={d.x} cy={d.y} r={1.6} className="fill-paper/20" />)}
      </svg>
      <div className="sourcing-scan-sweep pointer-events-none absolute inset-0" aria-hidden>
        <div className="h-full w-1/5 bg-gradient-to-r from-transparent via-violet/30 to-transparent" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-ink via-ink/70 to-transparent px-4 pb-3 pt-8 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <span className="sourcing-scan-beacon h-2 w-2 rounded-full bg-mantu-yellow" aria-hidden />
          Scanning {SOURCE_LABELS[step.source]}
        </p>
        <p className="tabular-nums text-paper/80">{found} {found === 1 ? "profile" : "profiles"} found</p>
      </div>
    </div>
  );
}
