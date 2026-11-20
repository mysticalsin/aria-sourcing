//! Dedupe and entity resolution for synthetic candidate records.
//!
//! Profile identity follows `candidateProfileIdentity` in `src/lib/rules.ts`:
//! http(s) URLs collapse host + path, dropping `www.` and a trailing slash,
//! and dropping the query string on linkedin.com and github.com. Anything else
//! is the trimmed lowercased original string.
//!
//! Entity resolution is the transitive closure of those strong keys (email,
//! LinkedIn, GitHub, source URL). A shared display name is not a key. The
//! 90-day recontact window is a dedupe policy, not an identity split.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use url::Url;

pub const DEDUPE_WINDOW_DAYS: f64 = 90.0;
const DAY_MS: f64 = 86_400_000.0;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub linkedin_url: String,
    #[serde(default)]
    pub github_url: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub current_company: String,
    #[serde(default)]
    pub last_contacted_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skipped {
    pub name: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DedupeOutput {
    pub accepted: Vec<Person>,
    pub skipped: Vec<Skipped>,
}

pub struct DedupeOptions<'a> {
    pub excluded_companies: &'a [String],
    pub current_company: Option<&'a str>,
    pub now_ms: i64,
}

pub fn profile_identity(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    match Url::parse(trimmed) {
        Ok(url) if url.scheme() == "http" || url.scheme() == "https" => {
            let host = url.host_str().unwrap_or("").to_lowercase();
            let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
            let path = url.path().trim_end_matches('/').to_lowercase();
            if host == "linkedin.com" || host == "github.com" {
                format!("{host}{path}")
            } else {
                match url.query() {
                    Some(query) => format!("{host}{path}?{query}"),
                    None => format!("{host}{path}"),
                }
            }
        }
        _ => trimmed.to_lowercase(),
    }
}

fn parse_js_instant_ms(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return None;
    }
    let year: i32 = std::str::from_utf8(&bytes[0..4]).ok()?.parse().ok()?;
    let month: u32 = std::str::from_utf8(&bytes[5..7]).ok()?.parse().ok()?;
    let day: u32 = std::str::from_utf8(&bytes[8..10]).ok()?.parse().ok()?;
    let hour: u32 = std::str::from_utf8(&bytes[11..13]).ok()?.parse().ok()?;
    let minute: u32 = std::str::from_utf8(&bytes[14..16]).ok()?.parse().ok()?;
    let second: u32 = std::str::from_utf8(&bytes[17..19]).ok()?.parse().ok()?;
    let millis: u32 = std::str::from_utf8(&bytes[20..23]).ok()?.parse().ok()?;
    if !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 60 || millis > 999 {
        return None;
    }
    Some(
        days_from_civil(year, month, day) * 86_400_000
            + hour as i64 * 3_600_000
            + minute as i64 * 60_000
            + second as i64 * 1000
            + millis as i64,
    )
}

/// Howard Hinnant's `days_from_civil`, days since Unix epoch.
fn days_from_civil(mut year: i32, month: u32, day: u32) -> i64 {
    year -= i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = (year - era * 400) as u32;
    let month_prime = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era as i64 * 146097 + day_of_era as i64 - 719468
}

fn days_since(iso: &str, now_ms: i64) -> Option<f64> {
    let then = parse_js_instant_ms(iso)?;
    Some((now_ms as f64 - then as f64) / DAY_MS)
}

pub fn dedupe_candidates(
    incoming: &[Person],
    existing: &[Person],
    opts: DedupeOptions<'_>,
) -> DedupeOutput {
    let mut accepted = Vec::new();
    let mut skipped = Vec::new();
    let mut seen_email: HashSet<String> = existing
        .iter()
        .map(|person| person.email.trim().to_lowercase())
        .collect();
    let mut seen_linkedin: HashSet<String> = existing
        .iter()
        .map(|person| profile_identity(&person.linkedin_url))
        .filter(|identity| !identity.is_empty())
        .collect();
    let mut seen_github: HashSet<String> = existing
        .iter()
        .map(|person| profile_identity(&person.github_url))
        .filter(|identity| !identity.is_empty())
        .collect();
    let mut seen_source: HashSet<String> = existing
        .iter()
        .map(|person| profile_identity(&person.source_url))
        .filter(|identity| !identity.is_empty())
        .collect();
    let excluded: HashSet<String> = opts
        .excluded_companies
        .iter()
        .map(|company| company.to_lowercase())
        .collect();
    let hiring = opts.current_company.map(|company| company.to_lowercase());

    for person in incoming {
        let email = person.email.trim().to_lowercase();
        let linkedin = profile_identity(&person.linkedin_url);
        let github = profile_identity(&person.github_url);
        let source = profile_identity(&person.source_url);
        let company = person.current_company.to_lowercase();

        if !email.is_empty() && seen_email.contains(&email) {
            skipped.push(Skipped {
                name: person.name.clone(),
                reason: "Duplicate email".to_string(),
            });
            continue;
        }
        if !linkedin.is_empty() && seen_linkedin.contains(&linkedin) {
            skipped.push(Skipped {
                name: person.name.clone(),
                reason: "Duplicate LinkedIn".to_string(),
            });
            continue;
        }
        if !github.is_empty() && seen_github.contains(&github) {
            skipped.push(Skipped {
                name: person.name.clone(),
                reason: "Duplicate GitHub".to_string(),
            });
            continue;
        }
        if !source.is_empty() && seen_source.contains(&source) {
            skipped.push(Skipped {
                name: person.name.clone(),
                reason: "Duplicate source profile".to_string(),
            });
            continue;
        }
        if excluded.contains(&company) {
            skipped.push(Skipped {
                name: person.name.clone(),
                reason: format!("Excluded company ({})", person.current_company),
            });
            continue;
        }
        if hiring.as_ref().is_some_and(|current| company == *current) {
            skipped.push(Skipped {
                name: person.name.clone(),
                reason: "Current/hiring company".to_string(),
            });
            continue;
        }
        if let Some(contacted) = person.last_contacted_at.as_deref() {
            if let Some(days) = days_since(contacted, opts.now_ms) {
                if days < DEDUPE_WINDOW_DAYS {
                    skipped.push(Skipped {
                        name: person.name.clone(),
                        reason: format!("Contacted < {DEDUPE_WINDOW_DAYS}d ago"),
                    });
                    continue;
                }
            }
        }

        accepted.push(person.clone());
        if !email.is_empty() {
            seen_email.insert(email);
        }
        if !linkedin.is_empty() {
            seen_linkedin.insert(linkedin);
        }
        if !github.is_empty() {
            seen_github.insert(github);
        }
        if !source.is_empty() {
            seen_source.insert(source);
        }
    }

    DedupeOutput { accepted, skipped }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntityCluster {
    pub entity_id: String,
    pub member_ids: Vec<String>,
}

/// Transitive strong-key resolution. Empty keys never join two records.
/// Display name and company are intentionally ignored.
pub fn resolve_entities(records: &[Person]) -> Vec<EntityCluster> {
    let mut parent: Vec<usize> = (0..records.len()).collect();
    fn find(parent: &mut [usize], mut index: usize) -> usize {
        while parent[index] != index {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        index
    }
    fn unite(parent: &mut [usize], left: usize, right: usize) {
        let left = find(parent, left);
        let right = find(parent, right);
        if left != right {
            if left < right {
                parent[right] = left;
            } else {
                parent[left] = right;
            }
        }
    }

    let mut email_owner: HashMap<String, usize> = HashMap::new();
    let mut linkedin_owner: HashMap<String, usize> = HashMap::new();
    let mut github_owner: HashMap<String, usize> = HashMap::new();
    let mut source_owner: HashMap<String, usize> = HashMap::new();
    for (index, person) in records.iter().enumerate() {
        let email = person.email.trim().to_lowercase();
        if !email.is_empty() {
            if let Some(previous) = email_owner.insert(email, index) {
                unite(&mut parent, previous, index);
            }
        }
        for (value, owners) in [
            (profile_identity(&person.linkedin_url), &mut linkedin_owner),
            (profile_identity(&person.github_url), &mut github_owner),
            (profile_identity(&person.source_url), &mut source_owner),
        ] {
            if value.is_empty() {
                continue;
            }
            if let Some(previous) = owners.insert(value, index) {
                unite(&mut parent, previous, index);
            }
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for index in 0..records.len() {
        groups
            .entry(find(&mut parent, index))
            .or_default()
            .push(index);
    }
    let mut clusters: Vec<EntityCluster> = groups
        .into_values()
        .map(|mut members| {
            members.sort_unstable();
            EntityCluster {
                entity_id: format!("e-{}", members[0]),
                member_ids: members
                    .into_iter()
                    .map(|index| records[index].name.clone())
                    .collect(),
            }
        })
        .collect();
    clusters.sort_by(|left, right| left.entity_id.cmp(&right.entity_id));
    clusters
}
