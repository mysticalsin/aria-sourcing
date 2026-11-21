package qc

import "encoding/json"

// Check identifiers. Reasons are always emitted in this order.
const (
	CheckGrounding   = "grounding"
	CheckProtected   = "protected"
	CheckOptOut      = "opt_out"
	CheckLength      = "length"
	CheckPlaceholder = "placeholder"
	CheckPromises    = "promises"
	CheckLanguage    = "language"
)

// ScopeCandidate and ScopeNeed select which facts can ground a claim.
const (
	ScopeCandidate = "candidate"
	ScopeNeed      = "need"
)

// AttributeLegalNationality marks a need fact whose value is a nationality
// the draft may name because the role legally requires it. Any other
// nationality, and any preference framing of this one, still fails.
const AttributeLegalNationality = "legal_nationality"

// Status is the gate outcome.
type Status string

const (
	StatusPass Status = "PASS"
	StatusFail Status = "FAIL"
)

// State is one step of the outreach QC state machine.
type State string

const (
	StateDraft     State = "Draft"
	StateQCPending State = "QCPending"
	StateQCPassed  State = "QCPassed"
	StateQCFailed  State = "QCFailed"
)

// Verdict is the ledger-facing result of one evaluation.
// The approval ledger may consume this interface. This package does not
// import the ledger.
type Verdict interface {
	Status() Status
	Score() float64
	QCVersion() string
	Reasons() []Reason
}

// Reason is one check outcome. Detail is always non-empty.
type Reason struct {
	Check  string `json:"check"`
	Pass   bool   `json:"pass"`
	Detail string `json:"detail"`
}

// Input is everything Evaluate may read. It is not retained.
type Input struct {
	Draft     Draft     `json:"draft"`
	Candidate Candidate `json:"candidate"`
	Need      Need      `json:"need"`
}

// Draft is the exact message a person would receive, plus the claims the
// author says it makes. Qualitative claims that are not listed are not
// inferred, except for a tenure pattern ("12 years").
type Draft struct {
	Channel  string  `json:"channel"`
	Subject  string  `json:"subject"`
	Body     string  `json:"body"`
	Language string  `json:"language,omitempty"`
	Claims   []Claim `json:"claims,omitempty"`
}

// Claim is one statement the draft makes. Scope defaults to candidate.
type Claim struct {
	Text  string `json:"text"`
	Scope string `json:"scope,omitempty"`
}

// Candidate holds the language the message must match and the only facts
// that may ground a statement about the person.
type Candidate struct {
	Language string `json:"language"`
	Facts    []Fact `json:"facts,omitempty"`
}

// Need holds facts about the role. They ground need-scoped claims and may
// carry AttributeLegalNationality. They never ground a candidate claim.
type Need struct {
	Facts []Fact `json:"facts,omitempty"`
}

// Fact is one supplied source statement.
type Fact struct {
	ID        string `json:"id,omitempty"`
	Scope     string `json:"scope"`
	Attribute string `json:"attribute,omitempty"`
	Text      string `json:"text,omitempty"`
	Value     string `json:"value,omitempty"`
}

// Result is the concrete Verdict Evaluate returns.
type Result struct {
	status  Status
	score   float64
	version string
	reasons []Reason
}

// Status reports PASS or FAIL.
func (r Result) Status() Status { return r.status }

// Score is in [0, 1]. It is the weighted fraction of checks that passed,
// with grounding able to contribute a partial weight. A failed check forces
// FAIL even when the score still clears the threshold.
func (r Result) Score() float64 { return r.score }

// QCVersion is the stable rule-set identifier.
func (r Result) QCVersion() string { return r.version }

// Reasons returns a copy of the per-check reasons in check order.
func (r Result) Reasons() []Reason {
	if len(r.reasons) == 0 {
		return nil
	}
	out := make([]Reason, len(r.reasons))
	copy(out, r.reasons)
	return out
}

// MarshalJSON emits the ledger-facing object: status, score, qc_version, reasons.
func (r Result) MarshalJSON() ([]byte, error) {
	payload := struct {
		Status    Status   `json:"status"`
		Score     float64  `json:"score"`
		QCVersion string   `json:"qc_version"`
		Reasons   []Reason `json:"reasons"`
	}{
		Status:    r.status,
		Score:     r.score,
		QCVersion: r.version,
		Reasons:   r.Reasons(),
	}
	return json.Marshal(payload)
}
