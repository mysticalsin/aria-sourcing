//! Line-for-line behavior port of `src/lib/scoring.ts` at mbe-branch
//! `e3fa3f594a6d86aec31d42a65414a96be4c8400e`.
//!
//! Ranking that calls this module is a suggestion. Nothing here rejects a
//! candidate or chooses a pipeline stage.

use crate::geo::{
    candidate_is_far_from_europe, candidate_matches_europe, europe_sourcing_hints,
    job_is_europe_focused, location_matches_region,
};
use regex::Regex;
use std::sync::LazyLock;

pub const UNKNOWN_ANCHOR: f64 = 30.0;
const UNKNOWN_RATIONALE: &str = "Requested but candidate value unknown - counted as unverified.";
const NOT_REQUESTED: &str = "Not requested by this role.";

static ACTIVITY_HIGH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"this week|days ago|active|shipped|merged|launched|speaking").unwrap()
});
static ACTIVITY_MED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"this month|recently|published|maintains|contribut").unwrap());
static ACTIVITY_LOW_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"last year|inactive|dormant|quiet").unwrap());
static ACTIVITY_SIGNAL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"this week|days ago|active|shipped|merged|launched|speaking|this month|recently|published|maintains|contribut|last year|inactive|dormant|quiet").unwrap()
});

#[derive(Clone, Debug, PartialEq)]
pub struct CandidateInput {
    pub tech_stack: Vec<String>,
    pub years_experience: Option<f64>,
    pub company_stage_experience: Vec<String>,
    pub industry_experience: Vec<String>,
    pub location: String,
    pub timezone: String,
    pub recent_activity: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct JobInput {
    pub location_type: String,
    pub location: String,
    pub regions: Vec<String>,
    pub timezone: String,
    pub required_skills: Vec<String>,
    pub nice_to_have_skills: Vec<String>,
    pub min_years_experience: Option<f64>,
    pub max_years_experience: Option<f64>,
    pub company_stage_target: Vec<String>,
    pub industry_experience: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Weights {
    pub skills: f64,
    pub experience: f64,
    pub company_stage: f64,
    pub industry: f64,
    pub location: f64,
    pub activity: f64,
}

impl Default for Weights {
    fn default() -> Self {
        Self {
            skills: 34.0,
            experience: 22.0,
            company_stage: 12.0,
            industry: 12.0,
            location: 10.0,
            activity: 10.0,
        }
    }
}

impl Weights {
    fn get(self, dim: Dim) -> f64 {
        match dim {
            Dim::Skills => self.skills,
            Dim::Experience => self.experience,
            Dim::CompanyStage => self.company_stage,
            Dim::Industry => self.industry,
            Dim::Location => self.location,
            Dim::Activity => self.activity,
        }
    }

    fn effective(self, dim: Dim) -> f64 {
        let value = self.get(dim);
        if value.is_finite() {
            value.max(0.0)
        } else {
            0.0
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BreakdownItem {
    pub key: String,
    pub label: String,
    pub score: f64,
    pub weight: f64,
    pub contribution: f64,
    pub rationale: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScoreResult {
    pub score: f64,
    /// Always true. A match score never rejects, suppresses, or advances a stage.
    pub suggestion_only: bool,
    pub breakdown: Vec<BreakdownItem>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Dim {
    Skills,
    Experience,
    CompanyStage,
    Industry,
    Location,
    Activity,
}

const DIMS: [Dim; 6] = [
    Dim::Skills,
    Dim::Experience,
    Dim::CompanyStage,
    Dim::Industry,
    Dim::Location,
    Dim::Activity,
];

impl Dim {
    fn key(self) -> &'static str {
        match self {
            Dim::Skills => "skills",
            Dim::Experience => "experience",
            Dim::CompanyStage => "companyStage",
            Dim::Industry => "industry",
            Dim::Location => "location",
            Dim::Activity => "activity",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Dim::Skills => "Skills match",
            Dim::Experience => "Experience fit",
            Dim::CompanyStage => "Company-stage fit",
            Dim::Industry => "Industry overlap",
            Dim::Location => "Location & timezone",
            Dim::Activity => "Signal & activity",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Scored,
    NotApplicable,
    Unknown,
}

struct DimensionResult {
    score: f64,
    rationale: String,
    state: State,
}

fn clamp(n: f64, min: f64, max: f64) -> f64 {
    n.max(min).min(max)
}

/// `Math.round` for finite values: half rounds toward +∞.
fn js_round_half_up(n: f64) -> f64 {
    (n + 0.5).floor()
}

fn js_round(n: f64, dp: i32) -> f64 {
    let factor = 10f64.powi(dp);
    js_round_half_up(n * factor) / factor
}

/// Print a finite number the way `Number#toFixed` does for values this engine produces.
pub fn format_fixed(n: f64, dp: u32) -> String {
    let scale = 10f64.powi(dp as i32);
    let rounded = (n * scale + 0.5).floor();
    let negative = rounded < 0.0;
    let digits = rounded.abs() as u64;
    let body = if dp == 0 {
        digits.to_string()
    } else {
        let div = 10u64.pow(dp);
        format!(
            "{}.{:0width$}",
            digits / div,
            digits % div,
            width = dp as usize
        )
    };
    if negative {
        format!("-{body}")
    } else {
        body
    }
}

fn js_number(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn lower_trim(value: &str) -> String {
    value.trim().to_lowercase()
}

fn overlap_count(left: &[String], right: &[String]) -> usize {
    let set: std::collections::HashSet<String> = right.iter().map(|s| lower_trim(s)).collect();
    left.iter()
        .filter(|item| set.contains(&lower_trim(item)))
        .count()
}

fn score_skills(candidate: &CandidateInput, job: &JobInput) -> (f64, String) {
    let req_hit = overlap_count(&job.required_skills, &candidate.tech_stack);
    let nice_hit = overlap_count(&job.nice_to_have_skills, &candidate.tech_stack);
    let req_ratio = if job.required_skills.is_empty() {
        0.7
    } else {
        req_hit as f64 / job.required_skills.len() as f64
    };
    let nice_ratio = if job.nice_to_have_skills.is_empty() {
        0.0
    } else {
        nice_hit as f64 / job.nice_to_have_skills.len() as f64
    };
    let score = clamp(req_ratio * 82.0 + nice_ratio * 18.0, 0.0, 100.0);
    let req_label = if job.required_skills.is_empty() {
        "—".to_string()
    } else {
        job.required_skills.len().to_string()
    };
    let nice_label = if job.nice_to_have_skills.is_empty() {
        "—".to_string()
    } else {
        job.nice_to_have_skills.len().to_string()
    };
    let rationale = format!(
        "{req_hit}/{req_label} required, {nice_hit}/{nice_label} nice-to-have skills present."
    );
    (score, rationale)
}

fn score_experience(candidate: &CandidateInput, job: &JobInput) -> (f64, String) {
    let Some(yrs) = candidate.years_experience else {
        return (50.0, "Experience not provided.".to_string());
    };
    let min = job.min_years_experience;
    let max = job.max_years_experience;
    if min.is_none() && max.is_none() {
        return (
            75.0,
            format!("{} yrs experience (no explicit band).", js_number(yrs)),
        );
    }
    if let Some(min) = min {
        if yrs < min {
            let gap = min - yrs;
            let score = clamp(72.0 - gap * 16.0, 8.0, 72.0);
            return (
                score,
                format!(
                    "{} yrs, {} below the {}-yr minimum.",
                    js_number(yrs),
                    js_number(gap),
                    js_number(min)
                ),
            );
        }
    }
    if let Some(max) = max {
        if yrs > max {
            let over = yrs - max;
            let score = clamp(90.0 - over * 7.0, 55.0, 90.0);
            return (
                score,
                format!(
                    "{} yrs, {} above the {}-yr ceiling (possible over-level).",
                    js_number(yrs),
                    js_number(over),
                    js_number(max)
                ),
            );
        }
    }
    (
        94.0,
        format!("{} yrs lands inside the target band.", js_number(yrs)),
    )
}

fn score_company_stage(candidate: &CandidateInput, job: &JobInput) -> (f64, String) {
    if job.company_stage_target.is_empty() {
        return (70.0, "No stage target set.".to_string());
    }
    if candidate.company_stage_experience.is_empty() {
        return (50.0, "Company-stage experience not provided.".to_string());
    }
    let hit = overlap_count(
        &candidate.company_stage_experience,
        &job.company_stage_target,
    );
    let score = clamp(
        40.0 + (hit as f64 / job.company_stage_target.len() as f64) * 60.0,
        30.0,
        100.0,
    );
    let rationale = if hit > 0 {
        format!(
            "Worked at {hit} of the {} target stages.",
            job.company_stage_target.len()
        )
    } else {
        format!(
            "No direct experience at target stages ({}).",
            job.company_stage_target.join(", ")
        )
    };
    (score, rationale)
}

fn score_industry(candidate: &CandidateInput, job: &JobInput) -> (f64, String) {
    if job.industry_experience.is_empty() {
        return (72.0, "No industry preference set.".to_string());
    }
    if candidate.industry_experience.is_empty() {
        return (50.0, "Industry experience not provided.".to_string());
    }
    let hit = overlap_count(&candidate.industry_experience, &job.industry_experience);
    let score = clamp(
        45.0 + (hit as f64 / job.industry_experience.len() as f64) * 55.0,
        35.0,
        100.0,
    );
    let rationale = if hit > 0 {
        let plural = if hit == 1 { "" } else { "s" };
        format!("Shares {hit} target industry vertical{plural}.")
    } else {
        "Adjacent industries only.".to_string()
    };
    (score, rationale)
}

fn nonempty(value: &str) -> bool {
    !value.is_empty()
}

fn score_location(candidate: &CandidateInput, job: &JobInput) -> (f64, String) {
    if candidate.location.trim().is_empty() && candidate.timezone.trim().is_empty() {
        return (50.0, "Location and timezone not provided.".to_string());
    }
    let regions: Vec<&str> = job.regions.iter().map(String::as_str).collect();
    let europe_focus = job_is_europe_focused(&regions, &job.timezone, &job.location);
    let europe_hit = candidate_matches_europe(&candidate.location, &candidate.timezone);
    let far_from_europe =
        europe_focus && candidate_is_far_from_europe(&candidate.location, &candidate.timezone);
    let place = if nonempty(&candidate.location) {
        candidate.location.as_str()
    } else {
        candidate.timezone.as_str()
    };

    if job.location_type == "Remote" {
        let timezone_aligned = nonempty(&candidate.timezone)
            && nonempty(&job.timezone)
            && (candidate.timezone.contains(&job.timezone)
                || job.timezone.contains(&candidate.timezone));
        let region_aligned = nonempty(&candidate.location)
            && job
                .regions
                .iter()
                .any(|region| location_matches_region(&candidate.location, region));
        if europe_focus {
            if timezone_aligned || europe_hit || region_aligned {
                let (score, rationale) = if timezone_aligned {
                    (
                        97.0,
                        format!(
                            "Remote Europe/EMEA role: timezone {} overlaps CET/UK hours.",
                            candidate.timezone
                        ),
                    )
                } else if europe_hit {
                    (
                        94.0,
                        format!("Remote Europe/EMEA role: Europe-based candidate ({place})."),
                    )
                } else {
                    (
                        90.0,
                        format!(
                            "Remote Europe/EMEA role: location {} matches a target region.",
                            candidate.location
                        ),
                    )
                };
                return (score, rationale);
            }
            if far_from_europe {
                return (
                    32.0,
                    format!("Remote Europe/EMEA role: {place} is outside European working hours."),
                );
            }
            return (
                58.0,
                "Remote Europe/EMEA role: European timezone/location not confirmed.".to_string(),
            );
        }
        let score = if timezone_aligned {
            96.0
        } else if region_aligned {
            90.0
        } else {
            80.0
        };
        let rationale = if timezone_aligned {
            format!(
                "Remote role: timezone {} overlaps working hours.",
                candidate.timezone
            )
        } else if region_aligned {
            format!(
                "Remote role: location {} matches a target region.",
                candidate.location
            )
        } else {
            "Remote role: working-hours overlap not confirmed.".to_string()
        };
        return (score, rationale);
    }

    let in_region = job
        .regions
        .iter()
        .any(|region| location_matches_region(&candidate.location, region))
        || (nonempty(&job.location) && location_matches_region(&candidate.location, &job.location));
    if europe_focus {
        if in_region || europe_hit {
            if in_region {
                return (
                    94.0,
                    format!(
                        "Based in {}, within Europe/EMEA {} range.",
                        candidate.location, job.location_type
                    ),
                );
            }
            return (
                90.0,
                format!("Europe signal present ({place}) for Europe-focused role."),
            );
        }
        if far_from_europe {
            return (
                28.0,
                format!("Based in {place}, outside Europe/EMEA catchment."),
            );
        }
        let where_ = if nonempty(&candidate.location) {
            candidate.location.as_str()
        } else {
            "unknown"
        };
        return (
            48.0,
            format!("Based in {where_}, Europe/EMEA catchment not confirmed."),
        );
    }
    let score = if in_region { 92.0 } else { 48.0 };
    let rationale = if in_region {
        format!(
            "Based in {}, within {} range.",
            candidate.location, job.location_type
        )
    } else {
        format!(
            "Based in {}, outside {} catchment.",
            candidate.location, job.location_type
        )
    };
    (score, rationale)
}

fn score_activity(candidate: &CandidateInput) -> (f64, String) {
    let text = candidate.recent_activity.to_lowercase();
    let score = if text.contains("no activity signal") {
        50.0
    } else if ACTIVITY_HIGH_RE.is_match(&text) {
        92.0
    } else if ACTIVITY_MED_RE.is_match(&text) {
        80.0
    } else if ACTIVITY_LOW_RE.is_match(&text) {
        45.0
    } else {
        62.0
    };
    (score, candidate.recent_activity.clone())
}

fn classify(candidate: &CandidateInput, job: &JobInput) -> [DimensionResult; 6] {
    let (skills_score, skills_rationale) = score_skills(candidate, job);
    let (experience_score, experience_rationale) = score_experience(candidate, job);
    let (stage_score, stage_rationale) = score_company_stage(candidate, job);
    let (industry_score, industry_rationale) = score_industry(candidate, job);
    let (location_score, location_rationale) = score_location(candidate, job);
    let (activity_score, activity_rationale) = score_activity(candidate);
    let role_requests_experience =
        job.min_years_experience.is_some() || job.max_years_experience.is_some();
    let has_activity_signal =
        ACTIVITY_SIGNAL_RE.is_match(&candidate.recent_activity.to_lowercase());

    let skills = if candidate.tech_stack.is_empty() {
        DimensionResult {
            score: skills_score,
            rationale: UNKNOWN_RATIONALE.to_string(),
            state: State::Unknown,
        }
    } else {
        DimensionResult {
            score: skills_score,
            rationale: skills_rationale,
            state: State::Scored,
        }
    };
    let experience = if !role_requests_experience {
        DimensionResult {
            score: experience_score,
            rationale: NOT_REQUESTED.to_string(),
            state: State::NotApplicable,
        }
    } else if candidate.years_experience.is_some() {
        DimensionResult {
            score: experience_score,
            rationale: experience_rationale,
            state: State::Scored,
        }
    } else {
        DimensionResult {
            score: experience_score,
            rationale: UNKNOWN_RATIONALE.to_string(),
            state: State::Unknown,
        }
    };
    let company_stage = if job.company_stage_target.is_empty() {
        DimensionResult {
            score: stage_score,
            rationale: NOT_REQUESTED.to_string(),
            state: State::NotApplicable,
        }
    } else if !candidate.company_stage_experience.is_empty() {
        DimensionResult {
            score: stage_score,
            rationale: stage_rationale,
            state: State::Scored,
        }
    } else {
        DimensionResult {
            score: stage_score,
            rationale: UNKNOWN_RATIONALE.to_string(),
            state: State::Unknown,
        }
    };
    let industry = if job.industry_experience.is_empty() {
        DimensionResult {
            score: industry_score,
            rationale: NOT_REQUESTED.to_string(),
            state: State::NotApplicable,
        }
    } else if !candidate.industry_experience.is_empty() {
        DimensionResult {
            score: industry_score,
            rationale: industry_rationale,
            state: State::Scored,
        }
    } else {
        DimensionResult {
            score: industry_score,
            rationale: UNKNOWN_RATIONALE.to_string(),
            state: State::Unknown,
        }
    };
    let location = if candidate.location.trim().is_empty() && candidate.timezone.trim().is_empty() {
        DimensionResult {
            score: location_score,
            rationale: UNKNOWN_RATIONALE.to_string(),
            state: State::Unknown,
        }
    } else {
        DimensionResult {
            score: location_score,
            rationale: location_rationale,
            state: State::Scored,
        }
    };
    let activity = if has_activity_signal {
        DimensionResult {
            score: activity_score,
            rationale: activity_rationale,
            state: State::Scored,
        }
    } else {
        DimensionResult {
            score: activity_score,
            rationale: NOT_REQUESTED.to_string(),
            state: State::NotApplicable,
        }
    };
    [
        skills,
        experience,
        company_stage,
        industry,
        location,
        activity,
    ]
}

pub fn score_candidate(
    candidate: &CandidateInput,
    job: &JobInput,
    weights: &Weights,
) -> ScoreResult {
    let dims = classify(candidate, job);
    let denom: f64 = dims
        .iter()
        .enumerate()
        .filter(|(_, item)| item.state != State::NotApplicable)
        .map(|(index, _)| weights.effective(DIMS[index]))
        .sum();

    let breakdown = DIMS
        .iter()
        .enumerate()
        .map(|(index, dim)| {
            let item = &dims[index];
            let excluded = item.state == State::NotApplicable || denom == 0.0;
            let weight_exact = if excluded {
                0.0
            } else {
                weights.effective(*dim) / denom
            };
            let effective_score = if item.state == State::Unknown {
                UNKNOWN_ANCHOR
            } else {
                item.score
            };
            let display_score = if excluded {
                item.score
            } else {
                effective_score
            };
            let contribution = if excluded {
                0.0
            } else {
                js_round(effective_score * weight_exact, 1)
            };
            BreakdownItem {
                key: dim.key().to_string(),
                label: dim.label().to_string(),
                score: js_round(clamp(display_score, 0.0, 100.0), 0),
                weight: js_round(weight_exact, 3),
                contribution,
                rationale: item.rationale.clone(),
            }
        })
        .collect::<Vec<_>>();
    let composite: f64 = breakdown.iter().map(|item| item.contribution).sum();
    ScoreResult {
        score: js_round(clamp(composite, 0.0, 100.0), 0),
        suggestion_only: true,
        breakdown,
    }
}

pub fn score_batch(
    candidates: &[CandidateInput],
    job: &JobInput,
    weights: &Weights,
) -> Vec<ScoreResult> {
    candidates
        .iter()
        .map(|candidate| score_candidate(candidate, job, weights))
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct RankedSuggestion {
    pub candidate_id: String,
    pub score: f64,
    pub rank: u32,
    pub suggestion_only: bool,
}

/// Order candidates by score, highest first. Every input is returned.
/// Ties break by id. A low score is still a suggestion: nobody is dropped.
pub fn rank_suggestions(items: &[(String, f64)]) -> Vec<RankedSuggestion> {
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by(|&left, &right| {
        let score_ord = items[right]
            .1
            .partial_cmp(&items[left].1)
            .unwrap_or(std::cmp::Ordering::Equal);
        score_ord.then_with(|| items[left].0.cmp(&items[right].0))
    });
    order
        .into_iter()
        .enumerate()
        .map(|(rank, index)| RankedSuggestion {
            candidate_id: items[index].0.clone(),
            score: items[index].1,
            rank: (rank as u32) + 1,
            suggestion_only: true,
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreBand {
    pub band: &'static str,
    pub count: usize,
}

pub fn score_distribution(scores: &[f64]) -> Vec<ScoreBand> {
    const BANDS: [(&str, f64, f64); 5] = [
        ("<55", 0.0, 55.0),
        ("55–69", 55.0, 70.0),
        ("70–79", 70.0, 80.0),
        ("80–89", 80.0, 90.0),
        ("90+", 90.0, 101.0),
    ];
    BANDS
        .into_iter()
        .map(|(band, min, max)| ScoreBand {
            band,
            count: scores
                .iter()
                .filter(|score| **score >= min && **score < max)
                .count(),
        })
        .collect()
}

pub fn europe_hints_for_job(job: &JobInput) -> Vec<String> {
    let regions: Vec<&str> = job.regions.iter().map(String::as_str).collect();
    europe_sourcing_hints(&regions, &job.timezone, &job.location)
}

pub fn job_europe_focused(job: &JobInput) -> bool {
    let regions: Vec<&str> = job.regions.iter().map(String::as_str).collect();
    job_is_europe_focused(&regions, &job.timezone, &job.location)
}
