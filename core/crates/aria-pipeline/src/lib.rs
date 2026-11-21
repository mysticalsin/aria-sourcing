//! Aria's own pipeline. These stages rebuild Smart's workflow inside Odoo.
//! They are not an external SMARTX mapping.
//!
//! Keys, in index order, shared with the C header and the Go binding:
//! `to_rate`, `to_assess`, `to_interview`, `shoot`, `qm`, `to_hire`,
//! `hired`, `rejected`, `withdrawn`.
//!
//! `hired` is terminal and guarded: it is reached only from `to_hire` when a
//! non-empty contract id is attached AND DNA (Mantu's ERP) has confirmed the
//! contract is integrated. Otherwise the candidate stays in `to_hire`.
//!
//! `rejected` and `withdrawn` are explicit named transitions. They require a
//! non-empty reason. A match score is not an input to this machine, so
//! ranking cannot auto-reject.

pub const STAGE_KEYS: [&str; 9] = [
    "to_rate",
    "to_assess",
    "to_interview",
    "shoot",
    "qm",
    "to_hire",
    "hired",
    "rejected",
    "withdrawn",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Stage {
    ToRate,
    ToAssess,
    ToInterview,
    Shoot,
    Qm,
    ToHire,
    Hired,
    Rejected,
    Withdrawn,
}

impl Stage {
    pub fn key(self) -> &'static str {
        match self {
            Stage::ToRate => "to_rate",
            Stage::ToAssess => "to_assess",
            Stage::ToInterview => "to_interview",
            Stage::Shoot => "shoot",
            Stage::Qm => "qm",
            Stage::ToHire => "to_hire",
            Stage::Hired => "hired",
            Stage::Rejected => "rejected",
            Stage::Withdrawn => "withdrawn",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "to_rate" => Some(Stage::ToRate),
            "to_assess" => Some(Stage::ToAssess),
            "to_interview" => Some(Stage::ToInterview),
            "shoot" => Some(Stage::Shoot),
            "qm" => Some(Stage::Qm),
            "to_hire" => Some(Stage::ToHire),
            "hired" => Some(Stage::Hired),
            "rejected" => Some(Stage::Rejected),
            "withdrawn" => Some(Stage::Withdrawn),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Stage::Hired | Stage::Rejected | Stage::Withdrawn)
    }

    /// Scoring never moves a stage. The score argument is deliberately unused.
    pub fn after_score_suggestion(self, _score: f64) -> Self {
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Advance,
    Reject,
    Withdraw,
}

impl Action {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "advance" => Some(Action::Advance),
            "reject" => Some(Action::Reject),
            "withdraw" => Some(Action::Withdraw),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Evidence {
    pub contract_id: Option<String>,
    pub dna_integrated: bool,
    pub reason: Option<String>,
}

impl Evidence {
    pub fn contract_attached(&self) -> bool {
        self.contract_id
            .as_ref()
            .is_some_and(|id| !id.trim().is_empty())
    }

    pub fn reason_text(&self) -> Option<&str> {
        self.reason
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub from: Stage,
    pub to: Stage,
    /// The hire guard refused `hired`. The candidate remains in `to_hire`.
    pub stayed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransitionError {
    UnknownStage,
    UnknownAction,
    Terminal { stage: Stage },
    ReasonRequired { action: Action },
}

pub fn transition(
    stage: Stage,
    action: Action,
    evidence: &Evidence,
) -> Result<Outcome, TransitionError> {
    if stage.is_terminal() {
        return Err(TransitionError::Terminal { stage });
    }
    let next = match (stage, action) {
        (Stage::ToRate, Action::Advance) => Stage::ToAssess,
        (Stage::ToAssess, Action::Advance) => Stage::ToInterview,
        (Stage::ToInterview, Action::Advance) => Stage::Shoot,
        (Stage::Shoot, Action::Advance) => Stage::Qm,
        (Stage::Qm, Action::Advance) => Stage::ToHire,
        (Stage::ToHire, Action::Advance) => {
            if evidence.contract_attached() && evidence.dna_integrated {
                Stage::Hired
            } else {
                return Ok(Outcome {
                    from: stage,
                    to: Stage::ToHire,
                    stayed: true,
                });
            }
        }
        (_, Action::Reject) | (_, Action::Withdraw) => {
            if evidence.reason_text().is_none() {
                return Err(TransitionError::ReasonRequired { action });
            }
            if action == Action::Reject {
                Stage::Rejected
            } else {
                Stage::Withdrawn
            }
        }
        _ => return Err(TransitionError::UnknownAction),
    };
    Ok(Outcome {
        from: stage,
        to: next,
        stayed: false,
    })
}

/// Walk `advance` from `to_rate`. Hiring still stops in `to_hire` unless the
/// evidence satisfies the contract and DNA guard on that last step.
pub fn advance_path(evidence: &Evidence) -> Vec<Stage> {
    let mut stage = Stage::ToRate;
    let mut seen = vec![stage];
    for _ in 0..8 {
        match transition(stage, Action::Advance, evidence) {
            Ok(outcome) if outcome.to != stage => {
                stage = outcome.to;
                seen.push(stage);
            }
            _ => break,
        }
    }
    seen
}
