//! p95 of scoring the shared 500-candidate synthetic fixture.
//! Prints one JSON object for the CI regression gate.

use aria_scoring::{score_batch, CandidateInput, JobInput, Weights};
use serde::Deserialize;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    batch500: Batch,
}

#[derive(Deserialize)]
struct Batch {
    job: FixJob,
    candidates: Vec<BatchCandidate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchCandidate {
    #[serde(flatten)]
    candidate: FixCandidate,
}

#[derive(Deserialize)]
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

#[derive(Deserialize)]
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

fn main() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/scoring-vectors.json");
    let fixture: Fixture =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture")).expect("json");
    let job = JobInput {
        location_type: fixture.batch500.job.location_type,
        location: fixture.batch500.job.location,
        regions: fixture.batch500.job.regions,
        timezone: fixture.batch500.job.timezone,
        required_skills: fixture.batch500.job.required_skills,
        nice_to_have_skills: fixture.batch500.job.nice_to_have_skills,
        min_years_experience: fixture.batch500.job.min_years_experience,
        max_years_experience: fixture.batch500.job.max_years_experience,
        company_stage_target: fixture.batch500.job.company_stage_target,
        industry_experience: fixture.batch500.job.industry_experience,
    };
    let candidates = fixture
        .batch500
        .candidates
        .into_iter()
        .map(|row| CandidateInput {
            tech_stack: row.candidate.tech_stack,
            years_experience: row.candidate.years_experience,
            company_stage_experience: row.candidate.company_stage_experience,
            industry_experience: row.candidate.industry_experience,
            location: row.candidate.location,
            timezone: row.candidate.timezone,
            recent_activity: row.candidate.recent_activity,
        })
        .collect::<Vec<_>>();
    assert_eq!(candidates.len(), 500);
    let weights = Weights::default();
    for _ in 0..20 {
        std::hint::black_box(score_batch(&candidates, &job, &weights));
    }
    const ITERATIONS: usize = 200;
    let mut samples = Vec::with_capacity(ITERATIONS);
    for _ in 0..ITERATIONS {
        let start = Instant::now();
        std::hint::black_box(score_batch(&candidates, &job, &weights));
        samples.push(start.elapsed().as_nanos() as u64);
    }
    samples.sort_unstable();
    let index = ((samples.len() as f64) * 0.95).ceil() as usize - 1;
    let p50 = samples[samples.len() / 2];
    println!(
        r#"{{"name":"score_batch_500_p95","unit":"ns","value":{},"p50_ns":{},"iterations":{}}}"#,
        samples[index], p50, ITERATIONS
    );
}
