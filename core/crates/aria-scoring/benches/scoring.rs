use aria_scoring::{score_batch, score_candidate, CandidateInput, JobInput, Weights};
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use serde::Deserialize;
use std::path::PathBuf;

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

fn load() -> (Vec<CandidateInput>, JobInput, CandidateInput) {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/scoring-vectors.json");
    let fixture: Fixture = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let job = job_from(&fixture.batch500.job);
    let candidates = fixture
        .batch500
        .candidates
        .iter()
        .map(|row| candidate_from(&row.candidate))
        .collect::<Vec<_>>();
    let one = candidates[0].clone();
    (candidates, job, one)
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

fn varied(seed: usize, candidates: &[CandidateInput]) -> CandidateInput {
    candidates[seed % candidates.len()].clone()
}

fn bench_scoring(c: &mut Criterion) {
    let (candidates, job, _) = load();
    let weights = Weights::default();
    let mut group = c.benchmark_group("scoring_criteria");
    group.sample_size(30);
    group.measurement_time(std::time::Duration::from_secs(1));
    // Each name is the dimension the fixture row exercises inside score_candidate.
    // The helpers stay private; the public composite is what production calls.
    for (name, index) in [
        ("skills", 0usize),
        ("experience", 1),
        ("company_stage", 2),
        ("industry", 3),
        ("location", 4),
        ("activity", 5),
        ("composite", 6),
    ] {
        let candidate = varied(index * 17, &candidates);
        group.bench_with_input(name, &candidate, |b, candidate| {
            b.iter(|| {
                black_box(score_candidate(
                    black_box(candidate),
                    black_box(&job),
                    black_box(&weights),
                ))
            })
        });
    }
    group.bench_function("score_batch_500", |b| {
        b.iter(|| {
            black_box(score_batch(
                black_box(&candidates),
                black_box(&job),
                black_box(&weights),
            ))
        })
    });
    group.finish();
}

criterion_group!(benches, bench_scoring);
criterion_main!(benches);
