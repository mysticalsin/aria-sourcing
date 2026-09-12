import { NextResponse } from "next/server";
import {
  appendLinkedInUiLesson,
  readLinkedInUiLessons,
  type LinkedInUiLessonGoal,
} from "@/lib/openbot/linkedin-ui-lessons";

export const dynamic = "force-dynamic";

/** Second-brain LinkedIn UI lessons for Browser Computer seats (not outreach copy). */
export async function GET() {
  const lessons = readLinkedInUiLessons();
  return NextResponse.json({
    lessons,
    summary: {
      total: lessons.length,
      wins: lessons.filter((l) => l.ok).length,
      fails: lessons.filter((l) => !l.ok).length,
    },
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
  } | null;
  if (!body?.goal || typeof body.ok !== "boolean" || !body.detail?.trim()) {
    return NextResponse.json({ error: "goal, ok, detail required" }, { status: 400 });
  }
  const lesson = appendLinkedInUiLesson({
    goal: body.goal,
    ok: body.ok,
    detail: body.detail,
    preferredName: body.preferredName,
  });
  return NextResponse.json({ lesson, lessons: readLinkedInUiLessons() });
}
