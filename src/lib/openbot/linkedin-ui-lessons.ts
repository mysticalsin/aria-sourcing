/**
 * Durable LinkedIn UI usage lessons for OpenBot Browser Computer seats.
 * Copy learning stays in outreach_skill; this store remembers how to drive
 * LinkedIn chrome like a human (which control worked / failed) — second brain
 * for the VM, not recruiter prose.
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
  | "path";

export type LinkedInUiLesson = {
  at: string;
  goal: LinkedInUiLessonGoal;
  ok: boolean;
  detail: string;
  preferredName?: string;
  seatId?: string | null;
  campaignId?: string | null;
};

const MAX_LESSONS = 80;

function lessonsPath(): string {
  const base =
    (process.env.ARIA_DATA_DIR ?? "").trim() || path.resolve(process.cwd(), "data");
  return path.join(base, "llm-wiki", "linkedin-ui-lessons.json");
}

function ensureDir(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
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
  };
  const file = lessonsPath();
  ensureDir(file);
  const prev = readLinkedInUiLessons();
  const next = [...prev, entry].slice(-MAX_LESSONS);
  writeFileSync(file, `${JSON.stringify({ lessons: next }, null, 2)}\n`, "utf8");
  const md = path.join(path.dirname(file), "linkedin-ui-lessons.md");
  const lines = [
    "# LinkedIn UI lessons (VM second brain)",
    "",
    "Machine-learned control paths for Browser Computer seats. Copy lessons stay in outreach_skill.",
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

/** Inject recent wins/fails into LLM element-pick goals (human-like memory). */
export function linkedInUiLessonHints(goal: LinkedInUiLessonGoal, limit = 4): string {
  const lessons = readLinkedInUiLessons()
    .filter((l) => l.goal === goal || l.goal === "path")
    .slice(-12);
  if (lessons.length === 0) return "";
  const wins = lessons.filter((l) => l.ok).slice(-limit);
  const fails = lessons.filter((l) => !l.ok).slice(-limit);
  const bits: string[] = [];
  for (const w of wins) {
    bits.push(
      w.preferredName
        ? `Prefer control named "${w.preferredName}" (worked before).`
        : `Prior win: ${w.detail}`,
    );
  }
  for (const f of fails) {
    bits.push(`Avoid repeating: ${f.detail}`);
  }
  return bits.length ? ` Learned UI lessons: ${bits.join(" ")}` : "";
}

/** Prefer Message vs Connect from recent path outcomes. */
export function preferConnectFromLessons(): boolean | null {
  const paths = readLinkedInUiLessons().filter((l) => l.goal === "path").slice(-10);
  if (paths.length < 2) return null;
  const connectOk = paths.filter((l) => l.ok && /connect/i.test(l.detail)).length;
  const messageOk = paths.filter((l) => l.ok && /message/i.test(l.detail)).length;
  const messageFail = paths.filter((l) => !l.ok && /message/i.test(l.detail)).length;
  if (connectOk > messageOk || messageFail > 0) return true;
  if (messageOk > connectOk) return false;
  return null;
}
