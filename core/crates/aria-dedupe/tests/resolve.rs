use aria_dedupe::{dedupe_candidates, profile_identity, resolve_entities, DedupeOptions, Person};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityFixture {
    now_ms: i64,
    window_days: f64,
    identities: Vec<IdentityRow>,
    dedupe: DedupeFixture,
}

#[derive(Debug, Deserialize)]
struct IdentityRow {
    value: String,
    identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DedupeFixture {
    incoming: Vec<Person>,
    existing: Vec<Person>,
    excluded_companies: Vec<String>,
    current_company: String,
    accepted: Vec<String>,
    skipped: Vec<Skip>,
}

#[derive(Debug, Deserialize)]
struct Skip {
    name: String,
    reason: String,
}

fn fixture() -> IdentityFixture {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/identity-vectors.json");
    let text = std::fs::read_to_string(&path).unwrap();
    serde_json::from_str(&text).unwrap()
}

#[test]
fn profile_identity_matches_typescript_vectors() {
    let fixture = fixture();
    assert_eq!(fixture.window_days, 90.0);
    for row in &fixture.identities {
        assert_eq!(
            profile_identity(&row.value),
            row.identity,
            "identity {:?}",
            row.value
        );
    }
}

#[test]
fn dedupe_matches_typescript_vectors() {
    let fixture = fixture();
    let output = dedupe_candidates(
        &fixture.dedupe.incoming,
        &fixture.dedupe.existing,
        DedupeOptions {
            excluded_companies: &fixture.dedupe.excluded_companies,
            current_company: Some(&fixture.dedupe.current_company),
            now_ms: fixture.now_ms,
        },
    );
    let accepted: Vec<_> = output
        .accepted
        .iter()
        .map(|person| person.name.as_str())
        .collect();
    assert_eq!(accepted, fixture.dedupe.accepted);
    assert_eq!(output.skipped.len(), fixture.dedupe.skipped.len());
    for (got, want) in output.skipped.iter().zip(&fixture.dedupe.skipped) {
        assert_eq!(got.name, want.name);
        assert_eq!(got.reason, want.reason);
    }
}

fn person(name: &str, email: &str, linkedin: &str, github: &str, source: &str) -> Person {
    Person {
        name: name.to_string(),
        email: email.to_string(),
        linkedin_url: linkedin.to_string(),
        github_url: github.to_string(),
        source_url: source.to_string(),
        current_company: "Example Labs".to_string(),
        last_contacted_at: None,
    }
}

#[test]
fn entity_resolution_is_transitive_on_strong_keys_only() {
    let records = vec![
        person("a", "a@example.test", "", "https://github.com/a-person", ""),
        person("b", "A@example.test", "", "", ""),
        person(
            "c",
            "c@example.test",
            "",
            "https://www.github.com/a-person/",
            "",
        ),
        person("d", "d@example.test", "", "", ""),
        person("e", "", "https://www.linkedin.com/in/E-Person", "", ""),
        person(
            "f",
            "f@example.test",
            "https://linkedin.com/in/e-person?trk=public",
            "",
            "",
        ),
        person("g", "", "", "", ""),
        person("h", "", "", "", ""),
        person("same-name", "", "", "", ""),
    ];
    // g, h, and same-name share a blank identity and must not collapse.
    let clusters = resolve_entities(&records);
    let members: Vec<Vec<&str>> = clusters
        .iter()
        .map(|cluster| cluster.member_ids.iter().map(String::as_str).collect())
        .collect();
    assert!(members.iter().any(|group| group == &["a", "b", "c"]));
    assert!(members.iter().any(|group| group == &["d"]));
    assert!(members.iter().any(|group| group == &["e", "f"]));
    assert!(members.iter().any(|group| group == &["g"]));
    assert!(members.iter().any(|group| group == &["h"]));
    assert!(members.iter().any(|group| group == &["same-name"]));
    assert_eq!(members.len(), 6);
}
