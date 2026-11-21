package interviewer

// Stage is an Odoo recruitment stage. The adapter reads it and never writes it.
type Stage string

const (
	StageToRate      Stage = "to_rate"
	StageToAssess    Stage = "to_assess"
	StageToInterview Stage = "to_interview"
	StageShoot       Stage = "shoot"
	StageQM          Stage = "qm"
	StageToHire      Stage = "to_hire"
	StageHired       Stage = "hired"
	StageRejected    Stage = "rejected"
	StageWithdrawn   Stage = "withdrawn"
)

// Candidate is the slice of an applicant the hand-off is allowed to see.
// Name and email stay in Odoo; only the candidate id crosses the boundary.
type Candidate struct {
	ID                    string
	Stage                 Stage
	HumanApprovalRecorded bool
	ApprovalID            string
	Language              string
	Consent               bool
}

// Need is the hiring need the human already approved for screening.
type Need struct {
	ID            string
	Summary       string
	RoleQuestions []string
}

// Score is one rubric dimension. Values are integers on the interviewer's 0–5 scale.
type Score struct {
	Name      string
	Value     int
	Reasoning string
}

// Report is the structured screening result. Advisory is always true:
// the recommendation informs a person and does not decide the stage.
type Report struct {
	Scores         []Score
	Overall        float64
	TranscriptRef  string
	Recommendation string
	Verdict        string
	Summary        string
	Advisory       bool
}

// Decision is how a caller is allowed to treat a hand-off. There is one value.
type Decision string

// DecisionAdvisory means a human still owns the stage change.
const DecisionAdvisory Decision = "advisory"

// Handoff is the caller's copy of the lifecycle. Stage is echoed from the
// candidate and is never rewritten by a recommendation.
type Handoff struct {
	State          State
	ScreeningID    string
	IdempotencyKey string
	Report         *Report
	Stage          Stage
	StageChanged   bool
	AutoRejected   bool
}

// Decision reports that the hand-off is advisory for every state, including
// a strong_no_hire recommendation and the zero value.
func (h Handoff) Decision() Decision { return DecisionAdvisory }
