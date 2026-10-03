interface RankedSourcingLesson {
  lessonId: string;
  platform: string;
  query: string;
  rank: number;
}

function uniqueReviewedQueries(reviewedQueries: readonly string[]): string[] {
  return reviewedQueries
    .map((query) => query.trim())
    .filter((query, index, all) => query.length > 0 && all.indexOf(query) === index);
}

/**
 * Graphify lessons never create query authority. A promoted lesson can only
 * select and rank a subset of the campaign's exact reviewed GitHub queries.
 */
export function prioritizeReviewedGithubQueries(
  reviewedQueries: readonly string[],
  promotedLessons: readonly RankedSourcingLesson[],
): string[] {
  const reviewed = uniqueReviewedQueries(reviewedQueries);
  const reviewedSet = new Set(reviewed);
  const preferred = promotedLessons
    .filter((lesson) =>
      lesson.platform === "GitHub" &&
      lesson.query === lesson.query.trim() &&
      reviewedSet.has(lesson.query)
    )
    .sort((left, right) => left.rank - right.rank || left.lessonId.localeCompare(right.lessonId))
    .map((lesson) => lesson.query)
    .filter((query, index, all) => all.indexOf(query) === index);
  // When promoted reviewed lessons exist, narrow this run's authority to that
  // ranked subset. DeerFlow can choose among them, but cannot silently bypass
  // the learning signal by selecting an unrelated baseline query.
  return preferred.length > 0 ? preferred : reviewed;
}

/** Returns receipts only for a lesson whose exact reviewed query was selected. */
export function appliedPromotedLessonIds(
  selectedQuery: string,
  reviewedQueries: readonly string[],
  promotedLessons: readonly RankedSourcingLesson[],
): string[] {
  const reviewedSet = new Set(uniqueReviewedQueries(reviewedQueries));
  if (!reviewedSet.has(selectedQuery)) return [];
  return promotedLessons
    .filter((lesson) =>
      lesson.platform === "GitHub" &&
      lesson.query === selectedQuery &&
      reviewedSet.has(lesson.query)
    )
    .sort((left, right) => left.rank - right.rank || left.lessonId.localeCompare(right.lessonId))
    .map((lesson) => lesson.lessonId)
    .filter((lessonId, index, all) => all.indexOf(lessonId) === index);
}
