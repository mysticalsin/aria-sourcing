import { NextResponse } from "next/server";
import {
  appendLinkedInUiLesson,
  linkedInUiLessonEfficiency,
  readLinkedInUiLessonIndex,
  readLinkedInUiLessons,
  type LinkedInUiLessonGoal,
} from "@/lib/openbot/linkedin-ui-lessons";

export const dynamic = "force-dynamic";

/** Second-brain LinkedIn UI lessons + efficiency totals for Browser Computer seats. */
export async function GET() {
  const lessons = readLinkedInUiLessons();
  const index = readLinkedInUiLessonIndex();
  const efficiency = linkedInUiLessonEfficiency();
  return NextResponse.json({
    lessons,
    index: {
      entries: index.entries.slice(-40),
      totals: index.totals,
    },
    summary: {
      total: lessons.length,
      wins: lessons.filter((l) => l.ok).length,
      fails: lessons.filter((l) => !l.ok).length,
      llmSkips: efficiency.llmSkips,
      tokensSaved: efficiency.tokensSaved,
      paceMultiplier: efficiency.paceMultiplier,
    },
    efficiency,
  });
}

/** Test/demo seed only — production lessons are appended by OpenBot send outcomes. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LESSON_SEED !== "1") {
    return NextResponse.json({ error: "lesson seed disabled" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    goal?: LinkedInUiLessonGoal;
    ok?: boolean;
    detail?: string;
    preferredName?: string;
    seatId?: string | null;
    campaignId?: string | null;
    durationMs?: number;
  } | null;
  if (!body?.goal || typeof body.ok !== "boolean" || !body.detail?.trim()) {
    return NextResponse.json({ error: "goal, ok, detail required" }, { status: 400 });
  }
  const lesson = appendLinkedInUiLesson({
    goal: body.goal,
    ok: body.ok,
    detail: body.detail,
    preferredName: body.preferredName,
    seatId: body.seatId,
    campaignId: body.campaignId,
    durationMs: body.durationMs,
  });
  return NextResponse.json({
    lesson,
    lessons: readLinkedInUiLessons(),
    efficiency: linkedInUiLessonEfficiency(body.seatId),
  });
}
