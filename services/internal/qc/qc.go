// Package qc is the stub quality check for full-auto outreach.
//
// Evaluate is pure. It does not send, call a model, read the clock, or open
// a network connection. A pass is not an approval.
package qc

import "strings"

// MinRubricScore is the floor. Below it, automatic mode cannot send.
const MinRubricScore = 80

// Evaluation is the stub result. Pass is true only when the body is not generic
// and the rubric clears the floor.
type Evaluation struct {
	Pass        bool
	RubricScore int
	Generic     bool
	Reasons     []string
}

var genericPhrases = []string{
	"i hope this message finds you well",
	"i hope this email finds you well",
	"i came across your profile",
	"dear sir or madam",
	"just bumping this",
	"just following up",
}

// DetectGeneric is the deterministic detector. Short copy fails closed.
func DetectGeneric(body string) bool {
	text := strings.ToLower(strings.TrimSpace(body))
	if len([]rune(text)) < 80 {
		return true
	}
	for _, phrase := range genericPhrases {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}

// Evaluate scores one body. A generic body cannot pass, even if a caller
// would rather lower the floor.
func Evaluate(body string) Evaluation {
	generic := DetectGeneric(body)
	score := MinRubricScore + 5
	if generic {
		score = MinRubricScore - 40
	}
	pass := !generic && score >= MinRubricScore
	out := Evaluation{Pass: pass, RubricScore: score, Generic: generic}
	if !pass {
		if generic {
			out.Reasons = []string{"generic-message"}
		} else {
			out.Reasons = []string{"rubric-below-floor"}
		}
	}
	return out
}
