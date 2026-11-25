//! The C ABI addresses rows by index. A shared display name is not a key.

use aria_core::{aria_dedupe_batch, aria_resolve_entities, AriaByteSpan, AriaIdentityIn, ARIA_OK};

struct Owned {
    name: String,
    email: String,
    linkedin: String,
    github: String,
    source: String,
    company: String,
    contacted: String,
}

impl Owned {
    fn new(name: &str, email: &str) -> Self {
        Self {
            name: name.to_string(),
            email: email.to_string(),
            linkedin: String::new(),
            github: String::new(),
            source: String::new(),
            company: "Example Labs".to_string(),
            contacted: String::new(),
        }
    }

    fn as_c(&self) -> AriaIdentityIn {
        AriaIdentityIn {
            name: span(&self.name),
            email: span(&self.email),
            linkedin_url: span(&self.linkedin),
            github_url: span(&self.github),
            source_url: span(&self.source),
            current_company: span(&self.company),
            last_contacted_at: span(&self.contacted),
        }
    }
}

fn span(text: &str) -> AriaByteSpan {
    if text.is_empty() {
        AriaByteSpan {
            data: std::ptr::null(),
            len: 0,
        }
    } else {
        AriaByteSpan {
            data: text.as_ptr(),
            len: text.len(),
        }
    }
}

#[test]
fn dedupe_accept_flag_follows_the_row_not_the_display_name() {
    let incoming = [
        Owned::new("Ada", "ada@example.test"),
        Owned::new("Ada", "fresh@example.test"),
    ];
    let existing = [Owned::new("Existing", "ada@example.test")];
    let incoming_c: Vec<_> = incoming.iter().map(Owned::as_c).collect();
    let existing_c: Vec<_> = existing.iter().map(Owned::as_c).collect();
    let mut accept = [99u32; 2];
    let code = unsafe {
        aria_dedupe_batch(
            incoming_c.as_ptr(),
            incoming_c.len(),
            existing_c.as_ptr(),
            existing_c.len(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            0,
            1_782_464_400_000,
            accept.as_mut_ptr(),
        )
    };
    assert_eq!(code, ARIA_OK);
    assert_eq!(
        accept,
        [0, 1],
        "same display name marked both rows accepted"
    );
}

#[test]
fn resolve_root_follows_the_row_not_the_display_name() {
    let records = [
        Owned::new("Bea", "bea@example.test"),
        Owned::new("Ada", "a@example.test"),
        Owned::new("Ada", "a@example.test"),
    ];
    let rows: Vec<_> = records.iter().map(Owned::as_c).collect();
    let mut roots = [7u32; 3];
    let code = unsafe { aria_resolve_entities(rows.as_ptr(), rows.len(), roots.as_mut_ptr()) };
    assert_eq!(code, ARIA_OK);
    assert_eq!(roots, [0, 1, 1], "the second Ada was left in Bea's cluster");
}
