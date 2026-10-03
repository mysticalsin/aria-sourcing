import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appliedPromotedLessonIds,
  prioritizeReviewedGithubQueries,
} from "../src/lib/sourcing/framework-learning-selection";

const reviewed = [
  "language:typescript location:montreal",
  "language:go location:toronto",
  "language:rust location:vancouver",
];

const lessons = [
  {
    lessonId: "11111111-1111-4111-8111-111111111111",
    platform: "GitHub" as const,
    query: reviewed[1],
    rank: 1,
  },
  {
    lessonId: "22222222-2222-4222-8222-222222222222",
    platform: "GitHub" as const,
    query: "language:python location:ottawa",
    rank: 2,
  },
  {
    lessonId: "33333333-3333-4333-8333-333333333333",
    platform: "Stack Overflow" as const,
    query: reviewed[2],
    rank: 3,
  },
];

test("a promoted exact-role lesson can only prioritize an exact reviewed GitHub query", () => {
  assert.deepEqual(prioritizeReviewedGithubQueries(reviewed, lessons), [
    reviewed[1],
  ]);
});

test("unreviewed and non-GitHub lesson queries never enter framework authority", () => {
  const prioritized = prioritizeReviewedGithubQueries(reviewed, lessons);
  assert.equal(prioritized.includes("language:python location:ottawa"), false);
  assert.equal(prioritized.every((query) => reviewed.includes(query)), true);
  assert.deepEqual(prioritizeReviewedGithubQueries(reviewed, []), reviewed);
});

test("durable lesson receipts include only the selected exact reviewed query", () => {
  assert.deepEqual(appliedPromotedLessonIds(reviewed[1], reviewed, lessons), [
    "11111111-1111-4111-8111-111111111111",
  ]);
  assert.deepEqual(
    appliedPromotedLessonIds("language:Go location:toronto", reviewed, lessons),
    [],
  );
  assert.deepEqual(
    appliedPromotedLessonIds("language:python location:ottawa", reviewed, lessons),
    [],
  );
});
