//! Red tests for the recontact window and profile identity.
//! `daysSince` in `src/lib/rules.ts` is `Date.parse`. These timestamps are
//! inside the 90-day window for `nowMs` 1782464400000 (2026-06-26T09:00:00Z)
//! in that parser, except the rows marked keep.

use aria_dedupe::{dedupe_candidates, profile_identity, DedupeOptions, Person};

const NOW_MS: i64 = 1_782_464_400_000;

fn person(name: &str, contacted: &str) -> Person {
    Person {
        name: name.to_string(),
        email: format!("{name}@example.test"),
        linkedin_url: String::new(),
        github_url: String::new(),
        source_url: String::new(),
        current_company: "Example Labs".to_string(),
        last_contacted_at: Some(contacted.to_string()),
    }
}

fn skipped_for_window(contacted: &str) -> bool {
    let output = dedupe_candidates(
        &[person("ada", contacted)],
        &[],
        DedupeOptions {
            excluded_companies: &[],
            current_company: None,
            now_ms: NOW_MS,
        },
    );
    output.skipped.iter().any(|row| row.reason.contains("90"))
}

#[test]
fn recontact_window_matches_js_date_parse() {
    let cases = [
        ("2026-06-16T09:00:00.000Z", true),
        ("2026-06-16T09:00:00Z", true),
        ("2026-06-16T09:00:00.000+00:00", true),
        ("2026-06-16T10:00:00+01:00", true),
        ("2026-06-16T09:00:00.000-03:00", true),
        ("2026-06-16T09:00:00.000+0000", true),
        ("2026-06-16", true),
        ("2026-06-16T24:00:00.000Z", true),
        ("2026-06-16t09:00:00.000z", true),
        ("2026-06-16T09:00:00.1234Z", true),
        ("2026-06-16T09:00:60.000Z", false),
        ("not-a-date", false),
        (" 2026-06-16T09:00:00.000Z", false),
        ("2026-02-31T00:00:00.000Z", false),
    ];
    for (contacted, want_skip) in cases {
        assert_eq!(
            skipped_for_window(contacted),
            want_skip,
            "{contacted} skip={want_skip}"
        );
    }

    // 2026-09-14T00:00:00Z is 89 days after 2026-06-17T00:00:00Z and exactly 90
    // days after 2026-06-16T00:00:00Z. T24:00:00 is the next midnight, so it
    // is still inside the window. Reading it as 00:00 the same day is not.
    let edge = dedupe_candidates(
        &[person("ada", "2026-06-16T24:00:00.000Z")],
        &[],
        DedupeOptions {
            excluded_companies: &[],
            current_company: None,
            now_ms: 1_789_344_000_000,
        },
    );
    assert!(
        edge.skipped.iter().any(|row| row.reason.contains("90")),
        "T24:00:00 was not the next midnight"
    );
}

#[test]
fn profile_identity_keeps_port_and_encoded_slash() {
    assert_eq!(
        profile_identity("https://linkedin.com:443/in/Ada"),
        profile_identity("https://linkedin.com/in/Ada"),
    );
    assert_eq!(
        profile_identity("https://linkedin.com:444/in/Ada"),
        "linkedin.com:444/in/ada"
    );
    assert_eq!(
        profile_identity("https://www.linkedin.com:444/in/Ada/?trk=Public"),
        "linkedin.com:444/in/ada"
    );
    assert_ne!(
        profile_identity("https://linkedin.com:444/in/Ada"),
        profile_identity("https://linkedin.com/in/Ada"),
    );
    assert_eq!(
        profile_identity("https://linkedin.com/in/a%2Fb"),
        "linkedin.com/in/a%2fb"
    );
    assert_ne!(
        profile_identity("https://linkedin.com/in/a%2Fb"),
        profile_identity("https://linkedin.com/in/a/b"),
    );
    assert_eq!(
        profile_identity("https://www.example.com/profile/Cam/?Ref=Ab"),
        "example.com/profile/cam?Ref=Ab"
    );
}
