//! Parity with Michael's TypeScript scoring. Vectors are generated from
//! `src/lib/scoring.ts` by `core/scripts/gen-scoring-vectors.mjs` before this
//! port is trusted. A score is a suggestion: low scores stay in the list.

use aria_scoring::{
    format_fixed, rank_suggestions, score_candidate, score_distribution, CandidateInput, JobInput,
    Weights,
};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    cases: Vec<Case>,
    distribution: Distribution,
    batch500: Batch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    candidate: FixCandidate,
    job: FixJob,
    weights: Option<RawWeights>,
    #[serde(default)]
    weights_special: Option<SpecialWeights>,
    expect: Expect,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixCandidate {
    tech_stack: Vec<String>,
    years_experience: Option<f64>,
    company_stage_experience: Vec<String>,
    industry_experience: Vec<String>,
    location: String,
    timezone: String,
    recent_activity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixJob {
    location_type: String,
    location: String,
    regions: Vec<String>,
    timezone: String,
    required_skills: Vec<String>,
    nice_to_have_skills: Vec<String>,
    min_years_experience: Option<f64>,
    max_years_experience: Option<f64>,
    company_stage_target: Vec<String>,
    industry_experience: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWeights {
    skills: Option<f64>,
    experience: f64,
    company_stage: f64,
    industry: f64,
    location: f64,
    activity: f64,
}

#[derive(Debug, Deserialize, Default)]
struct SpecialWeights {
    skills: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expect {
    score: f64,
    suggestion_only: bool,
    breakdown: Vec<ExpectItem>,
    geo: Geo,
}

#[derive(Debug, Deserialize)]
struct ExpectItem {
    key: String,
    label: String,
    score: f64,
    weight: String,
    contribution: String,
    rationale: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Geo {
    europe_focused: bool,
    matches_europe: bool,
    far_from_europe: bool,
    hints: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Distribution {
    scores: Vec<f64>,
    bands: Vec<Band>,
}

#[derive(Debug, Deserialize)]
struct Band {
    band: String,
    count: usize,
}

#[derive(Debug, Deserialize)]
struct Batch {
    job: FixJob,
    candidates: Vec<BatchCandidate>,
    expect: Vec<Expect>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchCandidate {
    id: String,
    #[serde(flatten)]
    candidate: FixCandidate,
}

fn fixture() -> Fixture {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/scoring-vectors.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    serde_json::from_str(&text).expect("scoring fixture")
}

fn candidate_from(value: &FixCandidate) -> CandidateInput {
    CandidateInput {
        tech_stack: value.tech_stack.clone(),
        years_experience: value.years_experience,
        company_stage_experience: value.company_stage_experience.clone(),
        industry_experience: value.industry_experience.clone(),
        location: value.location.clone(),
        timezone: value.timezone.clone(),
        recent_activity: value.recent_activity.clone(),
    }
}

fn job_from(value: &FixJob) -> JobInput {
    JobInput {
        location_type: value.location_type.clone(),
        location: value.location.clone(),
        regions: value.regions.clone(),
        timezone: value.timezone.clone(),
        required_skills: value.required_skills.clone(),
        nice_to_have_skills: value.nice_to_have_skills.clone(),
        min_years_experience: value.min_years_experience,
        max_years_experience: value.max_years_experience,
        company_stage_target: value.company_stage_target.clone(),
        industry_experience: value.industry_experience.clone(),
    }
}

fn weights_from(raw: &Option<RawWeights>, special: &Option<SpecialWeights>) -> Weights {
    let Some(raw) = raw else {
        return Weights::default();
    };
    let skills = match special.as_ref().and_then(|item| item.skills.as_deref()) {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        Some(text) => text.parse().expect("skills weight"),
        None => raw.skills.expect("skills weight"),
    };
    Weights {
        skills,
        experience: raw.experience,
        company_stage: raw.company_stage,
        industry: raw.industry,
        location: raw.location,
        activity: raw.activity,
    }
}

fn assert_expect(
    name: &str,
    result: &aria_scoring::ScoreResult,
    expect: &Expect,
    candidate: &CandidateInput,
    job: &JobInput,
) {
    assert!(result.suggestion_only, "{name} must stay suggestion-only");
    assert!(expect.suggestion_only, "{name} fixture");
    assert!(
        (result.score - expect.score).abs() < 1e-9,
        "{name} score {} != {}",
        result.score,
        expect.score
    );
    assert_eq!(result.breakdown.len(), expect.breakdown.len(), "{name}");
    for (got, want) in result.breakdown.iter().zip(&expect.breakdown) {
        assert_eq!(got.key, want.key, "{name}");
        assert_eq!(got.label, want.label, "{name}");
        assert!(
            (got.score - want.score).abs() < 1e-9,
            "{name} {} score",
            got.key
        );
        assert_eq!(
            format_fixed(got.weight, 3),
            want.weight,
            "{name} {} weight",
            got.key
        );
        assert_eq!(
            format_fixed(got.contribution, 1),
            want.contribution,
            "{name} {} contribution",
            got.key
        );
        assert_eq!(
            got.rationale, want.rationale,
            "{name} {} rationale",
            got.key
        );
    }
    assert_eq!(
        aria_scoring::job_europe_focused(job),
        expect.geo.europe_focused,
        "{name} europe focus"
    );
    assert_eq!(
        aria_scoring::candidate_matches_europe(&candidate.location, &candidate.timezone),
        expect.geo.matches_europe,
        "{name} matches europe"
    );
    assert_eq!(
        aria_scoring::candidate_is_far_from_europe(&candidate.location, &candidate.timezone),
        expect.geo.far_from_europe,
        "{name} far from europe"
    );
    assert_eq!(
        aria_scoring::europe_hints_for_job(job),
        expect.geo.hints,
        "{name} hints"
    );
}

#[test]
fn parity_with_typescript_vectors() {
    let fixture = fixture();
    assert!(
        fixture.cases.len() >= 40,
        "expected the hand-authored vector set"
    );
    for case in &fixture.cases {
        let candidate = candidate_from(&case.candidate);
        let job = job_from(&case.job);
        let weights = weights_from(&case.weights, &case.weights_special);
        let result = score_candidate(&candidate, &job, &weights);
        assert_expect(&case.name, &result, &case.expect, &candidate, &job);
    }
}

#[test]
fn parity_batch_of_500_synthetic_candidates() {
    let fixture = fixture();
    assert_eq!(fixture.batch500.candidates.len(), 500);
    let job = job_from(&fixture.batch500.job);
    let weights = Weights::default();
    for (index, row) in fixture.batch500.candidates.iter().enumerate() {
        let candidate = candidate_from(&row.candidate);
        let result = score_candidate(&candidate, &job, &weights);
        assert_expect(
            &format!("{}#{}", row.id, index),
            &result,
            &fixture.batch500.expect[index],
            &candidate,
            &job,
        );
        assert!(result.suggestion_only);
    }
}

#[test]
fn distribution_bands_match_typescript() {
    let fixture = fixture();
    let bands = score_distribution(&fixture.distribution.scores);
    assert_eq!(bands.len(), fixture.distribution.bands.len());
    for (got, want) in bands.iter().zip(&fixture.distribution.bands) {
        assert_eq!(got.band, want.band);
        assert_eq!(got.count, want.count);
    }
    assert_eq!(
        score_distribution(&[])
            .iter()
            .map(|band| band.count)
            .sum::<usize>(),
        0
    );
}

#[test]
fn signal_aware_relations_from_the_typescript_suite() {
    let fixture = fixture();
    let score = |name: &str| {
        fixture
            .cases
            .iter()
            .find(|case| case.name == name)
            .unwrap()
            .expect
            .score
    };
    let verified = score("signal-verified-experience");
    let unknown = score("signal-unknown-experience");
    let thin = score("thin-high-skill-below-floor");
    let broad = score("broad-verified-typescript-only");
    assert!(verified > unknown, "verified experience outranks unknown");
    assert!(
        thin < 70.0,
        "skills-only-high candidate stays below the contact floor, and is still not rejected"
    );
    assert!(
        thin < broad,
        "thin high-skill candidate does not outrank a broad verified candidate"
    );
    let europe = score("europe-remote-berlin");
    let us = score("europe-remote-new-york");
    let asia = score("europe-remote-singapore");
    assert!(
        europe > us && europe > asia,
        "Europe JD prefers the EU candidate"
    );
}

#[test]
fn ranking_is_suggestion_only_and_keeps_low_scores() {
    let ranked = rank_suggestions(&[
        ("syn-low@example.test".to_string(), 0.0),
        ("syn-high@example.test".to_string(), 99.0),
        ("syn-mid@example.test".to_string(), 12.5),
        ("syn-tie@example.test".to_string(), 99.0),
    ]);
    assert_eq!(ranked.len(), 4);
    assert!(ranked.iter().all(|item| item.suggestion_only));
    assert_eq!(ranked[0].candidate_id, "syn-high@example.test");
    assert_eq!(ranked[1].candidate_id, "syn-tie@example.test");
    assert_eq!(ranked[3].candidate_id, "syn-low@example.test");
    assert_eq!(ranked[3].rank, 4);
    assert!(ranked.iter().any(|item| item.score == 0.0));
}
