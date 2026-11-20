//! C ABI for in-process calls from Go. Scoring stays a suggestion: the batch
//! scorer never drops a row and never writes a reject decision.

use aria_dedupe::{dedupe_candidates, resolve_entities, DedupeOptions, Person};
use aria_ledger::{approval_hash_hex, ApprovalText};
use aria_pipeline::{transition, Action, Evidence, Stage, TransitionError, STAGE_KEYS};
use aria_scoring::{
    format_fixed, rank_suggestions, score_candidate, CandidateInput, JobInput, ScoreResult, Weights,
};
use std::ffi::CStr;
use std::os::raw::c_char;
use std::panic::{catch_unwind, AssertUnwindSafe};

pub const ARIA_OK: i32 = 0;
pub const ARIA_ERR_INVALID: i32 = 1;
pub const ARIA_ERR_BUFFER: i32 = 2;
pub const ARIA_ERR_UTF8: i32 = 3;
pub const ARIA_ERR_TERMINAL: i32 = 4;
pub const ARIA_ERR_REASON: i32 = 5;
pub const ARIA_ERR_ILLEGAL: i32 = 6;
pub const ARIA_ERR_PANIC: i32 = 7;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AriaByteSpan {
    pub data: *const u8,
    pub len: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AriaSpanList {
    pub items: *const AriaByteSpan,
    pub count: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AriaCandidateIn {
    pub id: AriaByteSpan,
    pub tech_stack: AriaSpanList,
    pub years_experience: f64,
    pub years_known: i32,
    pub company_stage_experience: AriaSpanList,
    pub industry_experience: AriaSpanList,
    pub location: AriaByteSpan,
    pub timezone: AriaByteSpan,
    pub recent_activity: AriaByteSpan,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AriaJobIn {
    pub location_type: AriaByteSpan,
    pub location: AriaByteSpan,
    pub regions: AriaSpanList,
    pub timezone: AriaByteSpan,
    pub required_skills: AriaSpanList,
    pub nice_to_have_skills: AriaSpanList,
    pub min_years: f64,
    pub has_min_years: i32,
    pub max_years: f64,
    pub has_max_years: i32,
    pub company_stage_target: AriaSpanList,
    pub industry_experience: AriaSpanList,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AriaWeightsIn {
    pub skills: f64,
    pub experience: f64,
    pub company_stage: f64,
    pub industry: f64,
    pub location: f64,
    pub activity: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AriaIdentityIn {
    pub name: AriaByteSpan,
    pub email: AriaByteSpan,
    pub linkedin_url: AriaByteSpan,
    pub github_url: AriaByteSpan,
    pub source_url: AriaByteSpan,
    pub current_company: AriaByteSpan,
    pub last_contacted_at: AriaByteSpan,
}

fn guard(body: impl FnOnce() -> i32) -> i32 {
    match catch_unwind(AssertUnwindSafe(body)) {
        Ok(code) => code,
        Err(_) => ARIA_ERR_PANIC,
    }
}

unsafe fn bytes<'a>(span: AriaByteSpan) -> Result<&'a [u8], i32> {
    if span.len == 0 {
        return Ok(&[]);
    }
    if span.data.is_null() {
        return Err(ARIA_ERR_INVALID);
    }
    Ok(std::slice::from_raw_parts(span.data, span.len))
}

unsafe fn owned_string(span: AriaByteSpan) -> Result<String, i32> {
    let text = bytes(span)?;
    String::from_utf8(text.to_vec()).map_err(|_| ARIA_ERR_UTF8)
}

unsafe fn owned_list(list: AriaSpanList) -> Result<Vec<String>, i32> {
    if list.count == 0 {
        return Ok(Vec::new());
    }
    if list.items.is_null() {
        return Err(ARIA_ERR_INVALID);
    }
    let items = std::slice::from_raw_parts(list.items, list.count);
    let mut out = Vec::with_capacity(items.len());
    for span in items {
        out.push(owned_string(*span)?);
    }
    Ok(out)
}

unsafe fn cstr<'a>(ptr: *const c_char) -> Result<&'a str, i32> {
    if ptr.is_null() {
        return Ok("");
    }
    CStr::from_ptr(ptr).to_str().map_err(|_| ARIA_ERR_UTF8)
}

unsafe fn candidate_from(input: &AriaCandidateIn) -> Result<CandidateInput, i32> {
    Ok(CandidateInput {
        tech_stack: owned_list(input.tech_stack)?,
        years_experience: if input.years_known == 0 {
            None
        } else {
            Some(input.years_experience)
        },
        company_stage_experience: owned_list(input.company_stage_experience)?,
        industry_experience: owned_list(input.industry_experience)?,
        location: owned_string(input.location)?,
        timezone: owned_string(input.timezone)?,
        recent_activity: owned_string(input.recent_activity)?,
    })
}

unsafe fn job_from(input: &AriaJobIn) -> Result<JobInput, i32> {
    Ok(JobInput {
        location_type: owned_string(input.location_type)?,
        location: owned_string(input.location)?,
        regions: owned_list(input.regions)?,
        timezone: owned_string(input.timezone)?,
        required_skills: owned_list(input.required_skills)?,
        nice_to_have_skills: owned_list(input.nice_to_have_skills)?,
        min_years_experience: if input.has_min_years == 0 {
            None
        } else {
            Some(input.min_years)
        },
        max_years_experience: if input.has_max_years == 0 {
            None
        } else {
            Some(input.max_years)
        },
        company_stage_target: owned_list(input.company_stage_target)?,
        industry_experience: owned_list(input.industry_experience)?,
    })
}

unsafe fn weights_from(input: *const AriaWeightsIn) -> Weights {
    if input.is_null() {
        return Weights::default();
    }
    let weights = &*input;
    Weights {
        skills: weights.skills,
        experience: weights.experience,
        company_stage: weights.company_stage,
        industry: weights.industry,
        location: weights.location,
        activity: weights.activity,
    }
}

fn score_json(result: &ScoreResult) -> String {
    let breakdown: Vec<serde_json::Value> = result
        .breakdown
        .iter()
        .map(|item| {
            serde_json::json!({
                "key": item.key,
                "label": item.label,
                "score": item.score,
                "weight": format_fixed(item.weight, 3),
                "contribution": format_fixed(item.contribution, 1),
                "rationale": item.rationale,
            })
        })
        .collect();
    serde_json::json!({
        "score": result.score,
        "suggestionOnly": true,
        "breakdown": breakdown,
    })
    .to_string()
}

unsafe fn person_from(input: &AriaIdentityIn) -> Result<Person, i32> {
    let contacted = owned_string(input.last_contacted_at)?;
    Ok(Person {
        name: owned_string(input.name)?,
        email: owned_string(input.email)?,
        linkedin_url: owned_string(input.linkedin_url)?,
        github_url: owned_string(input.github_url)?,
        source_url: owned_string(input.source_url)?,
        current_company: owned_string(input.current_company)?,
        last_contacted_at: if contacted.is_empty() {
            None
        } else {
            Some(contacted)
        },
    })
}

unsafe fn people(ptr: *const AriaIdentityIn, count: usize) -> Result<Vec<Person>, i32> {
    if count == 0 {
        return Ok(Vec::new());
    }
    if ptr.is_null() {
        return Err(ARIA_ERR_INVALID);
    }
    let rows = std::slice::from_raw_parts(ptr, count);
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(person_from(row)?);
    }
    Ok(out)
}

fn write_cstr(text: &str, buf: *mut c_char, cap: usize) -> Result<(), i32> {
    if buf.is_null() || cap == 0 {
        return Err(ARIA_ERR_BUFFER);
    }
    let bytes = text.as_bytes();
    if bytes.len() + 1 > cap {
        return Err(ARIA_ERR_BUFFER);
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf.cast::<u8>(), bytes.len());
        *buf.add(bytes.len()) = 0;
    }
    Ok(())
}

#[no_mangle]
pub extern "C" fn aria_core_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn aria_stage_count() -> u32 {
    STAGE_KEYS.len() as u32
}

#[no_mangle]
pub extern "C" fn aria_stage_key(index: u32, buf: *mut c_char, cap: usize) -> i32 {
    guard(|| {
        let Some(key) = STAGE_KEYS.get(index as usize) else {
            return ARIA_ERR_INVALID;
        };
        match write_cstr(key, buf, cap) {
            Ok(()) => ARIA_OK,
            Err(code) => code,
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn aria_score_batch(
    candidates: *const AriaCandidateIn,
    count: usize,
    job: *const AriaJobIn,
    weights: *const AriaWeightsIn,
    out_scores: *mut f64,
    out_suggestion_only: *mut i32,
) -> i32 {
    guard(|| {
        if count == 0 {
            return ARIA_OK;
        }
        if candidates.is_null() || job.is_null() || out_scores.is_null() {
            return ARIA_ERR_INVALID;
        }
        let weights = weights_from(weights);
        let job = match job_from(&*job) {
            Ok(job) => job,
            Err(code) => return code,
        };
        let rows = std::slice::from_raw_parts(candidates, count);
        for (index, row) in rows.iter().enumerate() {
            let candidate = match candidate_from(row) {
                Ok(candidate) => candidate,
                Err(code) => return code,
            };
            let scored = score_candidate(&candidate, &job, &weights);
            *out_scores.add(index) = scored.score;
            if !out_suggestion_only.is_null() {
                *out_suggestion_only.add(index) = 1;
            }
        }
        ARIA_OK
    })
}

#[no_mangle]
pub unsafe extern "C" fn aria_score_one_json(
    candidate: *const AriaCandidateIn,
    job: *const AriaJobIn,
    weights: *const AriaWeightsIn,
    buf: *mut c_char,
    cap: usize,
    out_len: *mut usize,
) -> i32 {
    guard(|| {
        if candidate.is_null() || job.is_null() {
            return ARIA_ERR_INVALID;
        }
        let weights = weights_from(weights);
        let candidate = match candidate_from(&*candidate) {
            Ok(candidate) => candidate,
            Err(code) => return code,
        };
        let job = match job_from(&*job) {
            Ok(job) => job,
            Err(code) => return code,
        };
        let json = score_json(&score_candidate(&candidate, &job, &weights));
        if !out_len.is_null() {
            *out_len = json.len();
        }
        match write_cstr(&json, buf, cap) {
            Ok(()) => ARIA_OK,
            Err(code) => code,
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn aria_rank_suggestions(
    scores: *const f64,
    count: usize,
    out_order: *mut u32,
) -> i32 {
    guard(|| {
        if count == 0 {
            return ARIA_OK;
        }
        if scores.is_null() || out_order.is_null() {
            return ARIA_ERR_INVALID;
        }
        let scores = std::slice::from_raw_parts(scores, count);
        let items: Vec<(String, f64)> = scores
            .iter()
            .enumerate()
            .map(|(index, score)| (format!("{index:08}"), *score))
            .collect();
        let ranked = rank_suggestions(&items);
        for (rank, item) in ranked.iter().enumerate() {
            let index: u32 = item.candidate_id.parse().unwrap_or(0);
            *out_order.add(rank) = index;
        }
        ARIA_OK
    })
}

#[no_mangle]
pub unsafe extern "C" fn aria_dedupe_batch(
    incoming: *const AriaIdentityIn,
    incoming_count: usize,
    existing: *const AriaIdentityIn,
    existing_count: usize,
    excluded_companies: *const AriaByteSpan,
    excluded_count: usize,
    current_company: *const u8,
    current_company_len: usize,
    now_ms: i64,
    out_accept: *mut u32,
) -> i32 {
    guard(|| {
        if incoming_count > 0 && (incoming.is_null() || out_accept.is_null()) {
            return ARIA_ERR_INVALID;
        }
        let incoming = match people(incoming, incoming_count) {
            Ok(rows) => rows,
            Err(code) => return code,
        };
        let existing = match people(existing, existing_count) {
            Ok(rows) => rows,
            Err(code) => return code,
        };
        let excluded = if excluded_count == 0 {
            Vec::new()
        } else {
            if excluded_companies.is_null() {
                return ARIA_ERR_INVALID;
            }
            let spans = std::slice::from_raw_parts(excluded_companies, excluded_count);
            let mut rows = Vec::with_capacity(spans.len());
            for span in spans {
                match owned_string(*span) {
                    Ok(text) => rows.push(text),
                    Err(code) => return code,
                }
            }
            rows
        };
        let hiring = if current_company_len == 0 {
            None
        } else {
            if current_company.is_null() {
                return ARIA_ERR_INVALID;
            }
            match String::from_utf8(
                std::slice::from_raw_parts(current_company, current_company_len).to_vec(),
            ) {
                Ok(text) => Some(text),
                Err(_) => return ARIA_ERR_UTF8,
            }
        };
        let output = dedupe_candidates(
            &incoming,
            &existing,
            DedupeOptions {
                excluded_companies: &excluded,
                current_company: hiring.as_deref(),
                now_ms,
            },
        );
        let accepted: std::collections::HashSet<&str> = output
            .accepted
            .iter()
            .map(|person| person.name.as_str())
            .collect();
        for (index, person) in incoming.iter().enumerate() {
            *out_accept.add(index) = u32::from(accepted.contains(person.name.as_str()));
        }
        ARIA_OK
    })
}

#[no_mangle]
pub unsafe extern "C" fn aria_resolve_entities(
    records: *const AriaIdentityIn,
    count: usize,
    out_entity: *mut u32,
) -> i32 {
    guard(|| {
        if count == 0 {
            return ARIA_OK;
        }
        if records.is_null() || out_entity.is_null() {
            return ARIA_ERR_INVALID;
        }
        let people = match people(records, count) {
            Ok(rows) => rows,
            Err(code) => return code,
        };
        let clusters = resolve_entities(&people);
        for cluster in clusters {
            let root = cluster
                .entity_id
                .trim_start_matches("e-")
                .parse::<u32>()
                .unwrap_or(0);
            for member in &cluster.member_ids {
                if let Some(index) = people.iter().position(|person| person.name == *member) {
                    *out_entity.add(index) = root;
                }
            }
        }
        ARIA_OK
    })
}

#[no_mangle]
pub unsafe extern "C" fn aria_approval_hash(
    channel: *const u8,
    channel_len: usize,
    recipient: *const u8,
    recipient_len: usize,
    subject: *const u8,
    subject_len: usize,
    body: *const u8,
    body_len: usize,
    notice: *const u8,
    notice_len: usize,
    out_hex: *mut c_char,
) -> i32 {
    guard(|| {
        if out_hex.is_null() {
            return ARIA_ERR_BUFFER;
        }
        let read = |ptr: *const u8, len: usize| -> Result<Vec<u8>, i32> {
            if len == 0 {
                return Ok(Vec::new());
            }
            if ptr.is_null() {
                return Err(ARIA_ERR_INVALID);
            }
            Ok(std::slice::from_raw_parts(ptr, len).to_vec())
        };
        let channel = match read(channel, channel_len) {
            Ok(bytes) => bytes,
            Err(code) => return code,
        };
        let recipient = match read(recipient, recipient_len) {
            Ok(bytes) => bytes,
            Err(code) => return code,
        };
        let subject = match read(subject, subject_len) {
            Ok(bytes) => bytes,
            Err(code) => return code,
        };
        let body = match read(body, body_len) {
            Ok(bytes) => bytes,
            Err(code) => return code,
        };
        let notice = match read(notice, notice_len) {
            Ok(bytes) => bytes,
            Err(code) => return code,
        };
        let hex = approval_hash_hex(&ApprovalText {
            channel: &channel,
            recipient_ref: &recipient,
            subject: &subject,
            body: &body,
            notice_version: &notice,
        });
        match write_cstr(&hex, out_hex, 65) {
            Ok(()) => ARIA_OK,
            Err(code) => code,
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn aria_pipeline_transition(
    stage: *const c_char,
    action: *const c_char,
    reason: *const c_char,
    contract_id: *const c_char,
    dna_integrated: i32,
    out_stage: *mut c_char,
    out_stage_cap: usize,
    out_stayed: *mut i32,
) -> i32 {
    guard(|| {
        let stage_text = match cstr(stage) {
            Ok(text) => text,
            Err(code) => return code,
        };
        let action_text = match cstr(action) {
            Ok(text) => text,
            Err(code) => return code,
        };
        let Some(stage) = Stage::parse(stage_text) else {
            return ARIA_ERR_INVALID;
        };
        let Some(action) = Action::parse(action_text) else {
            return ARIA_ERR_ILLEGAL;
        };
        let reason = match cstr(reason) {
            Ok(text) => text,
            Err(code) => return code,
        };
        let contract = match cstr(contract_id) {
            Ok(text) => text,
            Err(code) => return code,
        };
        let evidence = Evidence {
            contract_id: if contract.is_empty() {
                None
            } else {
                Some(contract.to_string())
            },
            dna_integrated: dna_integrated != 0,
            reason: if reason.is_empty() {
                None
            } else {
                Some(reason.to_string())
            },
        };
        match transition(stage, action, &evidence) {
            Ok(outcome) => {
                if write_cstr(outcome.to.key(), out_stage, out_stage_cap).is_err() {
                    return ARIA_ERR_BUFFER;
                }
                if !out_stayed.is_null() {
                    *out_stayed = i32::from(outcome.stayed);
                }
                ARIA_OK
            }
            Err(TransitionError::Terminal { .. }) => {
                let _ = write_cstr(stage.key(), out_stage, out_stage_cap);
                ARIA_ERR_TERMINAL
            }
            Err(TransitionError::ReasonRequired { .. }) => ARIA_ERR_REASON,
            Err(TransitionError::UnknownStage) => ARIA_ERR_INVALID,
            Err(TransitionError::UnknownAction) => ARIA_ERR_ILLEGAL,
        }
    })
}
