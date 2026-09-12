/**
 * Durable LinkedIn UI usage lessons for OpenBot Browser Computer seats.
 * Copy learning stays in outreach_skill; this store remembers how to drive
 * LinkedIn chrome like a human — and turns every lesson into efficiency:
 * fewer Aria LLM picks (tokens), shorter waits (speed), higher first-hit rate.
 *
 * Never invents sessionHealthy or delivery. Failures still go to Take control.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LinkedInUiLessonGoal =
  | "message"
  | "message_box"
  | "send"
  | "connect"
  | "add_note"
  | "invite_note"
  | "send_invite"
  | "login_wall"
  | "more_menu"
  | "path";

export type LinkedInUiLesson = {
  at: string;
  goal: LinkedInUiLessonGoal;
  ok: boolean;
  detail: string;
  preferredName?: string;
  seatId?: string | null;
  campaignId?: string | null;
  /** Optional observed action latency for adaptive pacing. */
  durationMs?: number;
  /** Heuristic estimate of Aria LLM tokens avoided by this lesson. */
  tokensSaved?: number;
};

/** Compact scored control memory — scales across N seats without dumping prose. */
export type LinkedInUiLessonIndexEntry = {
  seatId: string;
  goal: LinkedInUiLessonGoal;
  preferredName: string;
  wins: number;
  fails: number;
  lastAt: string;
  /** Rolling mean of successful step durations (ms). */
  avgDurationMs?: number;
  /** Cumulative estimated Aria tokens avoided by confident heuristic hits. */
  tokensSaved: number;
};

export type LinkedInUiLessonIndex = {
  version: 1;
  entries: LinkedInUiLessonIndexEntry[];
  totals: {
    lessons: number;
    llmSkips: number;
    tokensSaved: number;
  };
};

const MAX_LESSONS = 120;
const MAX_INDEX_ENTRIES = 400;
/** Min samples before we trust a control enough to skip Aria LLM. */
const MIN_SAMPLES_FOR_CONFIDENCE = 2;
/** Confidence threshold to skip LLM element pick (token save). */
const LLM_SKIP_CONFIDENCE = 0.72;
/** Confidence threshold to accelerate human pacing. */
const FAST_PACE_CONFIDENCE = 0.65;

function dataDir(): string {
  return (process.env.ARIA_DATA_DIR ?? "").trim() || path.resolve(process.cwd(), "data");
}

function lessonsPath(): string {
  return path.join(dataDir(), "llm-wiki", "linkedin-ui-lessons.json");
}

function indexPath(): string {
  return path.join(dataDir(), "llm-wiki", "linkedin-ui-lessons-index.json");
}

function ensureDir(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
}

function indexKey(seatId: string, goal: string, name: string): string {
  return `${seatId || "_"}|${goal}|${name.trim().toLowerCase()}`;
}

export function readLinkedInUiLessons(): LinkedInUiLesson[] {
  const file = lessonsPath();
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { lessons?: LinkedInUiLesson[] };
    return Array.isArray(raw.lessons) ? raw.lessons.slice(-MAX_LESSONS) : [];
  } catch {
    return [];
  }
}

export function readLinkedInUiLessonIndex(): LinkedInUiLessonIndex {
  const file = indexPath();
  if (!existsSync(file)) {
    return { version: 1, entries: [], totals: { lessons: 0, llmSkips: 0, tokensSaved: 0 } };
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as LinkedInUiLessonIndex;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) {
      return { version: 1, entries: [], totals: { lessons: 0, llmSkips: 0, tokensSaved: 0 } };
    }
    return {
      version: 1,
      entries: raw.entries.slice(-MAX_INDEX_ENTRIES),
      totals: {
        lessons: Number(raw.totals?.lessons ?? 0),
        llmSkips: Number(raw.totals?.llmSkips ?? 0),
        tokensSaved: Number(raw.totals?.tokensSaved ?? 0),
      },
    };
  } catch {
    return { version: 1, entries: [], totals: { lessons: 0, llmSkips: 0, tokensSaved: 0 } };
  }
}

function writeIndex(index: LinkedInUiLessonIndex) {
  const file = indexPath();
  ensureDir(file);
  const next: LinkedInUiLessonIndex = {
    version: 1,
    entries: index.entries.slice(-MAX_INDEX_ENTRIES),
    totals: index.totals,
  };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function upsertIndexEntry(
  index: LinkedInUiLessonIndex,
  lesson: LinkedInUiLesson,
): LinkedInUiLessonIndex {
  if (!lesson.preferredName?.trim()) {
    index.totals.lessons += 1;
    return index;
  }
  const seatId = lesson.seatId ?? "";
  const key = indexKey(seatId, lesson.goal, lesson.preferredName);
  const existing = index.entries.find(
    (e) => indexKey(e.seatId, e.goal, e.preferredName) === key,
  );
  if (existing) {
    if (lesson.ok) {
      existing.wins += 1;
      if (typeof lesson.durationMs === "number" && lesson.durationMs > 0) {
        const n = existing.wins;
        existing.avgDurationMs =
          ((existing.avgDurationMs ?? lesson.durationMs) * (n - 1) + lesson.durationMs) / n;
      }
    } else {
      existing.fails += 1;
    }
    existing.lastAt = lesson.at;
    if (lesson.tokensSaved) existing.tokensSaved += lesson.tokensSaved;
  } else {
    index.entries.push({
      seatId,
      goal: lesson.goal,
      preferredName: lesson.preferredName.trim(),
      wins: lesson.ok ? 1 : 0,
      fails: lesson.ok ? 0 : 1,
      lastAt: lesson.at,
      avgDurationMs: lesson.ok && lesson.durationMs ? lesson.durationMs : undefined,
      tokensSaved: lesson.tokensSaved ?? 0,
    });
  }
  index.totals.lessons += 1;
  if (lesson.tokensSaved) index.totals.tokensSaved += lesson.tokensSaved;
  // Keep hottest entries when oversized (wins-weighted, then recency).
  if (index.entries.length > MAX_INDEX_ENTRIES) {
    index.entries.sort((a, b) => {
      const as = a.wins * 2 - a.fails;
      const bs = b.wins * 2 - b.fails;
      if (bs !== as) return bs - as;
      return b.lastAt.localeCompare(a.lastAt);
    });
    index.entries = index.entries.slice(0, MAX_INDEX_ENTRIES);
  }
  return index;
}

export function appendLinkedInUiLesson(
  lesson: Omit<LinkedInUiLesson, "at"> & { at?: string },
): LinkedInUiLesson {
  const entry: LinkedInUiLesson = {
    at: lesson.at ?? new Date().toISOString(),
    goal: lesson.goal,
    ok: lesson.ok,
    detail: (lesson.detail ?? "").slice(0, 240),
    preferredName: lesson.preferredName?.trim() || undefined,
    seatId: lesson.seatId ?? null,
    campaignId: lesson.campaignId ?? null,
    durationMs: lesson.durationMs,
    tokensSaved: lesson.tokensSaved,
  };
  const file = lessonsPath();
  ensureDir(file);
  const prev = readLinkedInUiLessons();
  const next = [...prev, entry].slice(-MAX_LESSONS);
  writeFileSync(file, `${JSON.stringify({ lessons: next }, null, 2)}\n`, "utf8");

  const index = upsertIndexEntry(readLinkedInUiLessonIndex(), entry);
  writeIndex(index);

  const md = path.join(path.dirname(file), "linkedin-ui-lessons.md");
  const lines = [
    "# LinkedIn UI lessons (VM second brain)",
    "",
    "Machine-learned control paths for Browser Computer seats. Every lesson compounds into fewer LLM picks and faster pacing.",
    "",
    `Totals: ${index.totals.lessons} lessons · ${index.totals.llmSkips} LLM skips · ~${index.totals.tokensSaved} tokens saved`,
    "",
    ...next
      .slice(-24)
      .reverse()
      .map(
        (l) =>
          `- ${l.ok ? "OK" : "FAIL"} · **${l.goal}**${l.preferredName ? ` · \`${l.preferredName}\`` : ""} — ${l.detail} _(${l.at})_`,
      ),
    "",
  ];
  writeFileSync(md, `${lines.join("\n")}\n`, "utf8");
  return entry;
}

/** Record that a confident heuristic skipped an Aria LLM pick (token accounting). */
export function recordLinkedInUiLlmSkip(opts: {
  goal: LinkedInUiLessonGoal;
  preferredName: string;
  seatId?: string | null;
  /** Rough prompt tokens avoided (elements dump + goal). Default 900. */
  tokensSaved?: number;
}): void {
  const index = readLinkedInUiLessonIndex();
  const tokens = Math.max(0, opts.tokensSaved ?? 900);
  index.totals.llmSkips += 1;
  index.totals.tokensSaved += tokens;
  const seatId = opts.seatId ?? "";
  const key = indexKey(seatId, opts.goal, opts.preferredName);
  const existing = index.entries.find(
    (e) => indexKey(e.seatId, e.goal, e.preferredName) === key,
  );
  if (existing) existing.tokensSaved += tokens;
  writeIndex(index);
}

function scopedIndexEntries(
  goal: LinkedInUiLessonGoal,
  seatId?: string | null,
  opts?: { fallbackWorkspace?: boolean },
): LinkedInUiLessonIndexEntry[] {
  const index = readLinkedInUiLessonIndex();
  const forGoal = index.entries.filter((e) => e.goal === goal || e.goal === "path");
  if (!seatId) return forGoal;
  const seat = forGoal.filter((e) => e.seatId === seatId);
  // Hints may bootstrap from workspace; confidence/pacing stay seat-true for N-agent isolation.
  if (seat.length > 0) return seat;
  return opts?.fallbackWorkspace === false ? [] : forGoal;
}

function scopedLessons(
  goal: LinkedInUiLessonGoal,
  seatId?: string | null,
  opts?: { fallbackWorkspace?: boolean },
): LinkedInUiLesson[] {
  const all = readLinkedInUiLessons().filter((l) => l.goal === goal || l.goal === "path");
  if (!seatId) return all.slice(-12);
  const seat = all.filter((l) => l.seatId === seatId);
  if (seat.length > 0) return seat.slice(-12);
  // Explicit seat with no history stays empty when fallback disabled (pace/confidence isolation).
  if (opts?.fallbackWorkspace === false) return [];
  return all.slice(-12);
}

export type LessonConfidence = {
  /** 0–1 win rate with sample-size dampening. */
  score: number;
  samples: number;
  preferredName?: string;
  avgDurationMs?: number;
};

/** Confidence that we know the right control for this goal on this desk. */
export function linkedInUiLessonConfidence(
  goal: LinkedInUiLessonGoal,
  seatId?: string | null,
): LessonConfidence {
  const entries = scopedIndexEntries(goal, seatId, { fallbackWorkspace: false })
    .filter((e) => e.goal === goal)
    .sort((a, b) => b.wins * 2 - b.fails - (a.wins * 2 - a.fails));
  if (entries.length === 0) {
    // Fall back to raw lesson log when index is cold.
    const lessons = scopedLessons(goal, seatId, { fallbackWorkspace: false }).filter((l) => l.goal === goal);
    const wins = lessons.filter((l) => l.ok && l.preferredName);
    if (wins.length === 0) return { score: 0, samples: 0 };
    const name = wins[wins.length - 1]!.preferredName!;
    const nameWins = wins.filter((l) => l.preferredName === name).length;
    const nameFails = lessons.filter((l) => !l.ok && l.preferredName === name).length;
    const samples = nameWins + nameFails;
    const raw = samples === 0 ? 0 : nameWins / samples;
    const damp = Math.min(1, samples / MIN_SAMPLES_FOR_CONFIDENCE);
    return { score: raw * damp, samples, preferredName: name };
  }
  const top = entries[0]!;
  const samples = top.wins + top.fails;
  const raw = samples === 0 ? 0 : top.wins / samples;
  const damp = Math.min(1, samples / MIN_SAMPLES_FOR_CONFIDENCE);
  return {
    score: raw * damp,
    samples,
    preferredName: top.preferredName,
    avgDurationMs: top.avgDurationMs,
  };
}

/** True when lessons are strong enough to skip Aria LLM element pick. */
export function shouldSkipLinkedInUiLlm(
  goal: LinkedInUiLessonGoal,
  seatId?: string | null,
): boolean {
  const c = linkedInUiLessonConfidence(goal, seatId);
  return Boolean(c.preferredName) && c.samples >= MIN_SAMPLES_FOR_CONFIDENCE && c.score >= LLM_SKIP_CONFIDENCE;
}

/**
 * Ultra-compact hints for LLM prompts — minimizes tokens when LLM is still needed.
 * Prefer `prefer:Connect;avoid:Message` over prose paragraphs.
 */
export function linkedInUiLessonHints(
  goal: LinkedInUiLessonGoal,
  limit = 3,
  seatId?: string | null,
): string {
  const entries = scopedIndexEntries(goal, seatId)
    .filter((e) => e.goal === goal || e.goal === "path")
    .sort((a, b) => b.wins - a.wins)
    .slice(0, limit);
  if (entries.length === 0) {
    // Cold-start fallback from raw log — still keep it short.
    const lessons = scopedLessons(goal, seatId).slice(-6);
    if (lessons.length === 0) return "";
    const bits: string[] = [];
    for (const l of lessons.filter((x) => x.ok && x.preferredName).slice(-limit)) {
      bits.push(`prefer:${l.preferredName}`);
    }
    for (const l of lessons.filter((x) => !x.ok).slice(-2)) {
      const tag = l.preferredName ? `avoid:${l.preferredName}` : `avoid:${l.detail.slice(0, 40)}`;
      bits.push(tag);
    }
    return bits.length ? ` ui:${bits.join(";")}` : "";
  }
  const bits: string[] = [];
  for (const e of entries.filter((x) => x.wins > x.fails).slice(0, limit)) {
    bits.push(`prefer:${e.preferredName}`);
  }
  for (const e of entries.filter((x) => x.fails > x.wins).slice(0, 2)) {
    bits.push(`avoid:${e.preferredName}`);
  }
  return bits.length ? ` ui:${bits.join(";")}` : "";
}

/** Preferred control names for a goal, strongest first (desk-scoped when possible). */
export function preferredControlNames(
  goal: LinkedInUiLessonGoal,
  seatId?: string | null,
  limit = 3,
): string[] {
  const entries = scopedIndexEntries(goal, seatId, { fallbackWorkspace: false })
    .filter((e) => e.goal === goal)
    .sort((a, b) => {
      const as = a.wins * 2 - a.fails;
      const bs = b.wins * 2 - b.fails;
      return bs - as;
    });
  if (entries.length > 0) {
    return entries.slice(0, limit).map((e) => e.preferredName);
  }
  // Cold index: derive from raw lessons.
  const wins = scopedLessons(goal, seatId)
    .filter((l) => l.ok && l.preferredName)
    .slice(-8);
  const scores = new Map<string, number>();
  for (const w of wins) {
    const name = w.preferredName!.trim();
    if (!name) continue;
    scores.set(name, (scores.get(name) ?? 0) + 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

/**
 * Soft-rank heuristic candidates so a control that worked before wins ties.
 * Does not invent elements — only reorders matches already found.
 */
export function preferNamedHeuristic<T extends { name: string }>(
  candidates: T[],
  goal: LinkedInUiLessonGoal,
  seatId?: string | null,
): T | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const preferred = preferredControlNames(goal, seatId).map((n) => n.toLowerCase());
  if (preferred.length === 0) return candidates[0];
  const scored = [...candidates].sort((a, b) => {
    const ai = preferred.findIndex(
      (p) => a.name.toLowerCase() === p || a.name.toLowerCase().includes(p),
    );
    const bi = preferred.findIndex(
      (p) => b.name.toLowerCase() === p || b.name.toLowerCase().includes(p),
    );
    const as = ai === -1 ? 99 : ai;
    const bs = bi === -1 ? 99 : bi;
    return as - bs;
  });
  return scored[0];
}

/**
 * Direct pick from snapshot by lesson-preferred name — zero LLM tokens.
 * Returns undefined if no confident name match exists in the snapshot.
 */
export function pickElementByLesson<T extends { name: string; disabled?: boolean }>(
  elements: T[],
  goal: LinkedInUiLessonGoal,
  seatId?: string | null,
): T | undefined {
  const names = preferredControlNames(goal, seatId, 5).map((n) => n.toLowerCase());
  if (names.length === 0) return undefined;
  const enabled = elements.filter((el) => !el.disabled);
  for (const want of names) {
    const exact = enabled.find((el) => el.name.trim().toLowerCase() === want);
    if (exact) return exact;
  }
  for (const want of names) {
    const fuzzy = enabled.find((el) => el.name.trim().toLowerCase().includes(want));
    if (fuzzy) return fuzzy;
  }
  return undefined;
}

/** Prefer Message vs Connect from recent path outcomes (desk-aware). */
export function preferConnectFromLessons(seatId?: string | null): boolean | null {
  const paths = scopedIndexEntries("path", seatId).filter((e) => e.goal === "path");
  if (paths.length >= 1) {
    let connectScore = 0;
    let messageScore = 0;
    for (const e of paths) {
      const weight = e.wins - e.fails;
      if (/connect/i.test(e.preferredName) || /connect/i.test(e.goal)) connectScore += weight;
      if (/message/i.test(e.preferredName)) messageScore += weight;
    }
    // Also consult raw path lessons for detail text.
    const raw = scopedLessons("path", seatId).filter((l) => l.goal === "path");
    connectScore += raw.filter((l) => l.ok && /connect/i.test(l.detail)).length;
    messageScore += raw.filter((l) => l.ok && /message/i.test(l.detail)).length;
    messageScore -= raw.filter((l) => !l.ok && /message/i.test(l.detail)).length;
    if (connectScore > messageScore) return true;
    if (messageScore > connectScore) return false;
    return null;
  }
  const raw = scopedLessons("path", seatId).filter((l) => l.goal === "path");
  if (raw.length < 2) return null;
  const connectOk = raw.filter((l) => l.ok && /connect/i.test(l.detail)).length;
  const messageOk = raw.filter((l) => l.ok && /message/i.test(l.detail)).length;
  const messageFail = raw.filter((l) => !l.ok && /message/i.test(l.detail)).length;
  if (connectOk > messageOk || messageFail > 0) return true;
  if (messageOk > connectOk) return false;
  return null;
}

/**
 * Adaptive human-like pause — accelerates when lessons are confident,
 * slows after recent fails. Every win makes the next run faster.
 */
export function humanUiPaceMs(
  kind: "navigate" | "read" | "click" | "type" | "proof",
  seatId?: string | null,
): number {
  const base =
    kind === "navigate"
      ? 900
      : kind === "read"
        ? 550
        : kind === "click"
          ? 420
          : kind === "type"
            ? 380
            : 700;
  const jitter = Math.floor((Date.now() % 17) * 18); // 0–288ms
  let ms = base + jitter;

  const conf = linkedInUiLessonConfidence("path", seatId);
  if (conf.score >= FAST_PACE_CONFIDENCE && conf.samples >= MIN_SAMPLES_FOR_CONFIDENCE) {
    // Confident desk: cut waits ~40% (floor so we stay human-like).
    ms = Math.max(Math.floor(base * 0.55), Math.floor(ms * 0.6));
    if (conf.avgDurationMs && conf.avgDurationMs < base) {
      ms = Math.min(ms, Math.max(180, Math.floor(conf.avgDurationMs * 0.85)));
    }
  } else if (conf.samples >= 1 && conf.score < 0.4) {
    // Recent fails: slow down slightly for reliability.
    ms = Math.floor(ms * 1.2);
  }
  return ms;
}

export async function humanUiPause(
  kind: "navigate" | "read" | "click" | "type" | "proof",
  seatId?: string | null,
): Promise<void> {
  const ms = humanUiPaceMs(kind, seatId);
  await new Promise((r) => setTimeout(r, ms));
}

/** Efficiency snapshot for Skills UI / ops. */
export function linkedInUiLessonEfficiency(seatId?: string | null): {
  lessons: number;
  llmSkips: number;
  tokensSaved: number;
  topControls: Array<{ goal: string; name: string; wins: number; fails: number; confidence: number }>;
  paceMultiplier: number;
} {
  const index = readLinkedInUiLessonIndex();
  const conf = linkedInUiLessonConfidence("path", seatId);
  const paceMultiplier =
    conf.score >= FAST_PACE_CONFIDENCE && conf.samples >= MIN_SAMPLES_FOR_CONFIDENCE ? 0.6 : 1;
  const entries = (seatId
    ? index.entries.filter((e) => e.seatId === seatId || !e.seatId)
    : index.entries
  )
    .slice()
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 8)
    .map((e) => {
      const samples = e.wins + e.fails;
      const raw = samples === 0 ? 0 : e.wins / samples;
      const damp = Math.min(1, samples / MIN_SAMPLES_FOR_CONFIDENCE);
      return {
        goal: e.goal,
        name: e.preferredName,
        wins: e.wins,
        fails: e.fails,
        confidence: Number((raw * damp).toFixed(2)),
      };
    });
  return {
    lessons: index.totals.lessons,
    llmSkips: index.totals.llmSkips,
    tokensSaved: index.totals.tokensSaved,
    topControls: entries,
    paceMultiplier,
  };
}
