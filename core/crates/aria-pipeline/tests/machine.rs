use aria_pipeline::{
    advance_path, transition, Action, Evidence, Stage, TransitionError, STAGE_KEYS,
};

fn evidence(contract: Option<&str>, dna: bool, reason: Option<&str>) -> Evidence {
    Evidence {
        contract_id: contract.map(str::to_string),
        dna_integrated: dna,
        reason: reason.map(str::to_string),
    }
}

#[test]
fn stage_keys_are_the_shared_odoo_names() {
    let parsed: Vec<_> = STAGE_KEYS
        .iter()
        .map(|key| Stage::parse(key).unwrap().key())
        .collect();
    assert_eq!(parsed, STAGE_KEYS);
    assert!(
        Stage::parse("To Rate").is_none(),
        "display labels are not keys"
    );
    assert!(Stage::parse("to-rate").is_none());
    assert!(Stage::parse("SMARTX").is_none());
}

#[test]
fn test_hired_requires_contract_and_dna() {
    let cases = [
        (None, false, Stage::ToHire),
        (Some("contract-example-1"), false, Stage::ToHire),
        (None, true, Stage::ToHire),
        (Some("   "), true, Stage::ToHire),
        (Some("contract-example-1"), true, Stage::Hired),
    ];
    for (contract, dna, expect) in cases {
        let outcome = transition(
            Stage::ToHire,
            Action::Advance,
            &evidence(contract, dna, None),
        )
        .unwrap();
        assert_eq!(outcome.to, expect, "contract={contract:?} dna={dna}");
        assert_eq!(outcome.stayed, expect == Stage::ToHire);
    }

    let hired = transition(
        Stage::ToHire,
        Action::Advance,
        &evidence(Some("contract-example-1"), true, None),
    )
    .unwrap();
    assert_eq!(hired.to, Stage::Hired);
    assert!(matches!(
        transition(
            Stage::Hired,
            Action::Advance,
            &evidence(Some("contract-example-1"), true, None)
        ),
        Err(TransitionError::Terminal {
            stage: Stage::Hired
        })
    ));

    // Flags on an earlier stage do not skip the path or hire early.
    let early = transition(
        Stage::ToRate,
        Action::Advance,
        &evidence(Some("contract-example-1"), true, None),
    )
    .unwrap();
    assert_eq!(early.to, Stage::ToAssess);

    let path = advance_path(&evidence(Some("contract-example-1"), true, None));
    assert_eq!(
        path,
        vec![
            Stage::ToRate,
            Stage::ToAssess,
            Stage::ToInterview,
            Stage::Shoot,
            Stage::Qm,
            Stage::ToHire,
            Stage::Hired,
        ]
    );
}

#[test]
fn test_to_hire_is_default_without_contract() {
    let to_hire = transition(Stage::Qm, Action::Advance, &evidence(None, false, None)).unwrap();
    assert_eq!(to_hire.to, Stage::ToHire);
    assert!(!to_hire.stayed);

    let stayed = transition(Stage::ToHire, Action::Advance, &evidence(None, true, None)).unwrap();
    assert_eq!(stayed.to, Stage::ToHire);
    assert!(stayed.stayed);

    let also_stayed = transition(
        Stage::ToHire,
        Action::Advance,
        &evidence(Some(""), false, None),
    )
    .unwrap();
    assert_eq!(also_stayed.to, Stage::ToHire);
    assert!(also_stayed.stayed);

    let path = advance_path(&Evidence::default());
    assert_eq!(*path.last().unwrap(), Stage::ToHire);
    assert!(!path.contains(&Stage::Hired));
    assert!(!path.contains(&Stage::Rejected));
}

#[test]
fn reject_and_withdraw_are_explicit_and_guarded() {
    let missing = transition(Stage::ToAssess, Action::Reject, &Evidence::default());
    assert_eq!(
        missing,
        Err(TransitionError::ReasonRequired {
            action: Action::Reject
        })
    );
    let blank = transition(
        Stage::Shoot,
        Action::Withdraw,
        &evidence(None, false, Some("  ")),
    );
    assert_eq!(
        blank,
        Err(TransitionError::ReasonRequired {
            action: Action::Withdraw
        })
    );

    let rejected = transition(
        Stage::ToInterview,
        Action::Reject,
        &evidence(None, false, Some("Role closed, synthetic reason")),
    )
    .unwrap();
    assert_eq!(rejected.to, Stage::Rejected);
    assert!(transition(Stage::Rejected, Action::Advance, &Evidence::default()).is_err());

    let withdrawn = transition(
        Stage::ToRate,
        Action::Withdraw,
        &evidence(None, false, Some("Candidate withdrew")),
    )
    .unwrap();
    assert_eq!(withdrawn.to, Stage::Withdrawn);
}

#[test]
fn ranking_never_moves_a_stage_or_auto_rejects() {
    for score in [0.0, 30.0, 69.0, 70.0, 100.0] {
        for stage in [
            Stage::ToRate,
            Stage::ToAssess,
            Stage::ToInterview,
            Stage::Shoot,
            Stage::Qm,
            Stage::ToHire,
        ] {
            let next = stage.after_score_suggestion(score);
            assert_eq!(next, stage);
            assert_ne!(next, Stage::Rejected);
            assert_ne!(next, Stage::Withdrawn);
            assert_ne!(next, Stage::Hired);
        }
    }
}

#[test]
fn forward_path_is_one_step_at_a_time() {
    let steps = [
        (Stage::ToRate, Stage::ToAssess),
        (Stage::ToAssess, Stage::ToInterview),
        (Stage::ToInterview, Stage::Shoot),
        (Stage::Shoot, Stage::Qm),
        (Stage::Qm, Stage::ToHire),
    ];
    for (from, to) in steps {
        let outcome = transition(from, Action::Advance, &Evidence::default()).unwrap();
        assert_eq!(outcome.to, to);
        assert_eq!(outcome.to.key(), to.key());
    }
}
