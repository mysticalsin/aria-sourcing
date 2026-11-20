//! Suggestion-only candidate scoring.
//!
//! This is a behavior port of Michael's `src/lib/scoring.ts`. A score is a
//! suggestion for a recruiter. This crate has no reject action and no
//! pipeline transition.

mod geo;
mod score;

pub use geo::{
    candidate_is_far_from_europe, candidate_matches_europe, europe_sourcing_hints,
    job_is_europe_focused, location_matches_europe_macro, location_matches_region,
};
pub use score::{
    europe_hints_for_job, format_fixed, job_europe_focused, rank_suggestions, score_batch,
    score_candidate, score_distribution, BreakdownItem, CandidateInput, JobInput, RankedSuggestion,
    ScoreBand, ScoreResult, Weights, UNKNOWN_ANCHOR,
};
