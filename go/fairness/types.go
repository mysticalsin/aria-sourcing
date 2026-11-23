package fairness

// Verdict is the explicit outcome of a check or of the whole audit.
// Disparity checks use Insufficient when a group is below the minimum size.
type Verdict string

const (
	VerdictInsufficient Verdict = "Insufficient"
	VerdictPass         Verdict = "Pass"
	VerdictWarn         Verdict = "Warn"
	VerdictFail         Verdict = "Fail"

	// DefaultMinGroupSize is the smallest consented group that can carry a
	// disparity verdict. Below it the audit records a warning and no verdict.
	DefaultMinGroupSize = 30

	// DefaultEpsilon is the counterfactual absolute-score tolerance.
	DefaultEpsilon = 1e-6

	// ExposureWarnGap is the absolute mean-exposure gap that warns while the
	// exposure ratio is still at least 4/5. It is an operational review
	// threshold, not a legal rule.
	ExposureWarnGap = 0.05

	// ReferenceYear is the fixed year used when a graduation year is described
	// as an age proxy. It is not read from the clock, so audits stay repeatable.
	ReferenceYear = 2026

	CheckParity         = "selection-rate-parity"
	CheckExposure       = "exposure-gap"
	CheckCounterfactual = "counterfactual"
	CheckProxies        = "proxy-features"
	CheckExplanations   = "explanation-completeness"

	// Disclaimer is copied into every report. The wording is the product limit.
	Disclaimer = "This audit supports recruiter prioritisation only. A human decides. There is no auto-reject. It does not certify compliance with the EU AI Act, the GDPR, or anti-discrimination law."

	SelectionRateFormula = "selectionRate(g) = selected(g) / n(g)"
	FourFifthsFormula    = "ratio(g) = selectionRate(g) / selectionRate(reference); adverse impact when selected(g) * n(reference) * 5 < selected(reference) * n(g) * 4 (ratio < 4/5). Exactly 4/5 is not adverse impact. A ratio in [4/5, 9/10) warns."
	ExposureFormula      = "exposure(i) = 1 / log2(rank(i) + 1); exposure(g) is the mean; gap(g) = exposure(reference) - exposure(g)"
)

// ProtectedLabel is an optional self-declared label. Both Consented and
// SelfDeclared must be true before the audit may count it. The label is not
// a ranking feature.
type ProtectedLabel struct {
	Attribute    string `json:"attribute"`
	Value        string `json:"value"`
	Consented    bool   `json:"consented"`
	SelfDeclared bool   `json:"selfDeclared"`
}

// Candidate is one row of a ranking run. Rank 1 is the top of the list.
type Candidate struct {
	ID             string          `json:"id"`
	Rank           int             `json:"rank"`
	Score          float64         `json:"score"`
	Text           string          `json:"text"`
	Features       map[string]any  `json:"features"`
	Reasons        []string        `json:"reasons"`
	ProtectedGroup *ProtectedLabel `json:"protectedGroup,omitempty"`
}

// Run is the offline input. SelectionCutoff selects candidates with Rank <= cutoff.
type Run struct {
	RunID           string      `json:"runId"`
	Seed            int64       `json:"seed"`
	SelectionCutoff int         `json:"selectionCutoff"`
	MinGroupSize    int         `json:"minGroupSize,omitempty"`
	Epsilon         float64     `json:"epsilon,omitempty"`
	Candidates      []Candidate `json:"candidates"`
}

// ScoreView is the only struct a Scorer may see. It has no protected-group field.
type ScoreView struct {
	ID       string         `json:"id"`
	Text     string         `json:"text"`
	Features map[string]any `json:"features"`
}

// Scorer rescores one candidate from ranking features and text. Implementations
// used in tests are fakes. The audit does not ship a model.
type Scorer interface {
	Score(view ScoreView) (float64, error)
}

// Options overrides sample size and epsilon and optionally plugs in a Scorer.
// A nil Scorer leaves the counterfactual check unrun and does not change the
// verdict of the checks that can be read from the ranking file alone.
type Options struct {
	MinGroupSize int
	Epsilon      float64
	Scorer       Scorer
}

// GenSpec controls a deterministic synthetic run. Zero N and Cutoff use defaults.
// ProxyEvery N adds proxy features on every Nth candidate, starting at 0.
// Zero ProxyEvery adds none.
type GenSpec struct {
	N            int
	Cutoff       int
	MinGroupSize int
	Attribute    string
	Groups       []string
	ProxyEvery   int
}

// Check is one named gate in the report.
type Check struct {
	Name    string  `json:"name"`
	Verdict Verdict `json:"verdict"`
	Detail  string  `json:"detail"`
}

// GroupMetric is the selection rate and exposure of one consented group.
type GroupMetric struct {
	Attribute     string  `json:"attribute"`
	Group         string  `json:"group"`
	N             int     `json:"n"`
	Selected      int     `json:"selected"`
	SelectionRate float64 `json:"selectionRate"`
	MeanRank      float64 `json:"meanRank"`
	Exposure      float64 `json:"exposure"`
	Verdict       Verdict `json:"verdict"`
}

// FourFifthsRow is one group's adverse-impact comparison.
type FourFifthsRow struct {
	Attribute      string  `json:"attribute"`
	Group          string  `json:"group"`
	ReferenceGroup string  `json:"referenceGroup"`
	N              int     `json:"n"`
	Selected       int     `json:"selected"`
	SelectionRate  float64 `json:"selectionRate"`
	ReferenceN     int     `json:"referenceN"`
	ReferenceRate  float64 `json:"referenceRate"`
	Ratio          float64 `json:"ratio"`
	RatioDefined   bool    `json:"ratioDefined"`
	AdverseImpact  bool    `json:"adverseImpact"`
	Verdict        Verdict `json:"verdict"`
	Warning        string  `json:"warning,omitempty"`
}

// ExposureRow is the rank-position exposure gap against the most exposed group.
type ExposureRow struct {
	Attribute         string  `json:"attribute"`
	Group             string  `json:"group"`
	ReferenceGroup    string  `json:"referenceGroup"`
	N                 int     `json:"n"`
	Exposure          float64 `json:"exposure"`
	ReferenceExposure float64 `json:"referenceExposure"`
	Ratio             float64 `json:"ratio"`
	Gap               float64 `json:"gap"`
	Verdict           Verdict `json:"verdict"`
	Warning           string  `json:"warning,omitempty"`
}

// CounterfactualCase is one name or gender-marker swap for one candidate.
type CounterfactualCase struct {
	CandidateID string  `json:"candidateId"`
	Kind        string  `json:"kind"`
	From        string  `json:"from"`
	To          string  `json:"to"`
	Original    float64 `json:"original"`
	Swapped     float64 `json:"swapped"`
	Delta       float64 `json:"delta"`
	Within      bool    `json:"withinEpsilon"`
}

// CounterfactualResult is empty of scores when no Scorer was provided.
type CounterfactualResult struct {
	Ran          bool                 `json:"ran"`
	Verdict      Verdict              `json:"verdict"`
	Epsilon      float64              `json:"epsilon"`
	Cases        []CounterfactualCase `json:"cases"`
	UncoveredIDs []string             `json:"uncoveredIds"`
	Detail       string               `json:"detail"`
}

// ProxyFlag is one ranking feature that can stand in for a protected attribute.
type ProxyFlag struct {
	Feature      string   `json:"feature"`
	Reason       string   `json:"reason"`
	CandidateIDs []string `json:"candidateIds"`
}

// ExplanationResult records whether every ranked candidate has a top reason.
type ExplanationResult struct {
	Verdict    Verdict  `json:"verdict"`
	Complete   bool     `json:"complete"`
	MissingIDs []string `json:"missingIds"`
	Detail     string   `json:"detail"`
}

// Report is the machine-readable audit. AutoReject is always false.
type Report struct {
	RunID                 string               `json:"runId"`
	Verdict               Verdict              `json:"verdict"`
	Disclaimer            string               `json:"disclaimer"`
	AutoReject            bool                 `json:"autoReject"`
	HumanDecisionRequired bool                 `json:"humanDecisionRequired"`
	MinGroupSize          int                  `json:"minGroupSize"`
	Epsilon               float64              `json:"epsilon"`
	DiscardedLabels       int                  `json:"discardedLabels"`
	Checks                []Check              `json:"checks"`
	Groups                []GroupMetric        `json:"groups"`
	FourFifths            []FourFifthsRow      `json:"fourFifths"`
	Exposure              []ExposureRow        `json:"exposure"`
	Counterfactual        CounterfactualResult `json:"counterfactual"`
	Proxies               []ProxyFlag          `json:"proxies"`
	Explanations          ExplanationResult    `json:"explanations"`
	Warnings              []string             `json:"warnings"`
}
