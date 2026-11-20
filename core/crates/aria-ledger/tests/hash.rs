use aria_ledger::{
    approval_hash, approval_hash_hex, canonical_bytes, to_hex, ApprovalText, CANONICAL_VERSION,
};
use sha2::{Digest, Sha256};

fn sample(body: &[u8]) -> ApprovalText<'_> {
    ApprovalText {
        channel: b"email",
        recipient_ref: b"ada@example.test",
        subject: b"Hello Ada",
        body,
        notice_version: b"art14-lgpd-2026-11",
    }
}

#[test]
fn sha256_empty_vector_locks_the_algorithm() {
    let digest = Sha256::digest(b"");
    assert_eq!(
        to_hex(&digest),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn canonical_layout_is_length_prefixed_and_stable() {
    let text = sample(b"Exact body");
    let bytes = canonical_bytes(&text);
    assert!(bytes.starts_with(CANONICAL_VERSION));
    assert_eq!(bytes[CANONICAL_VERSION.len()], 0);
    assert_eq!(approval_hash_hex(&text), approval_hash_hex(&text));
    assert_eq!(approval_hash_hex(&text).len(), 64);

    let slid_left = ApprovalText {
        channel: b"emaile",
        recipient_ref: b"",
        ..text
    };
    let slid_right = ApprovalText {
        channel: b"email",
        recipient_ref: b"e",
        ..text
    };
    assert_ne!(approval_hash(&slid_left), approval_hash(&slid_right));
}

#[test]
fn any_byte_change_alters_the_hash() {
    let body = b"Exact outreach body for ada@example.test.\nSecond line stays put. Synthetic only.";
    let base = sample(body);
    let base_hash = approval_hash(&base);

    for index in 0..body.len() {
        let mut mutated = body.to_vec();
        mutated[index] ^= 0xff;
        let hash = approval_hash(&sample(&mutated));
        assert_ne!(hash, base_hash, "body byte {index} did not change the hash");
    }

    let fields: [(&str, ApprovalText<'_>); 4] = [
        (
            "channel",
            ApprovalText {
                channel: b"emaiL",
                ..base
            },
        ),
        (
            "recipient",
            ApprovalText {
                recipient_ref: b"ada@example.tesT",
                ..base
            },
        ),
        (
            "subject",
            ApprovalText {
                subject: b"Hello AdA",
                ..base
            },
        ),
        (
            "notice",
            ApprovalText {
                notice_version: b"art14-lgpd-2026-12",
                ..base
            },
        ),
    ];
    for (name, text) in fields {
        assert_ne!(approval_hash(&text), base_hash, "{name}");
    }

    let canonical = canonical_bytes(&base);
    for index in 0..canonical.len() {
        let mut mutated = canonical.clone();
        mutated[index] ^= 0x01;
        let hash = Sha256::digest(&mutated);
        assert_ne!(
            hash.as_slice(),
            base_hash.as_slice(),
            "canonical byte {index}"
        );
    }
}

#[test]
fn interior_nul_and_high_bit_are_distinct() {
    let with_nul = sample(b"line\0break");
    let without = sample(b"linebreak");
    let high = sample(&[0xff, 0xfe, b'A']);
    assert_ne!(approval_hash(&with_nul), approval_hash(&without));
    assert_ne!(approval_hash(&high), approval_hash(&without));
}
