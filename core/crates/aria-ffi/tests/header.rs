#[test]
fn header_lists_the_shared_stage_keys_in_order() {
    let header = include_str!("../../../include/aria_core.h");
    let mut rest = header;
    for key in [
        "to_rate",
        "to_assess",
        "to_interview",
        "shoot",
        "qm",
        "to_hire",
        "hired",
        "rejected",
        "withdrawn",
    ] {
        let needle = format!("\"{key}\"");
        let pos = rest
            .find(&needle)
            .unwrap_or_else(|| panic!("header missing {key}"));
        rest = &rest[pos + needle.len()..];
    }
    assert!(header.contains("#define ARIA_CORE_ABI_VERSION 1"));
}
