// Package stage is the recruiting stage contract shared by the Go services.
//
// Rust, Go, and Odoo line up on these exact keys. A later change will move
// the list into one shared spec file and add a drift test. Until then this
// package is the Go copy of that contract:
//
//	to_rate, to_assess, to_interview, shoot, qm, to_hire, hired, rejected, withdrawn
//
// The pipeline rebuilt from SMARTX is to_rate -> to_assess -> to_interview ->
// shoot -> qm -> to_hire. hired is a gated terminal state: the graph allows
// it only from to_hire, and the hire gate still requires a contract plus DNA
// integration. rejected and withdrawn are terminal exits. There is no skip,
// no backward move, and no reopen.
package stage

import (
	"errors"
	"fmt"
)

const (
	ToRate      = "to_rate"
	ToAssess    = "to_assess"
	ToInterview = "to_interview"
	Shoot       = "shoot"
	QM          = "qm"
	ToHire      = "to_hire"
	Hired       = "hired"
	Rejected    = "rejected"
	Withdrawn   = "withdrawn"
)

// ErrTransition means the pair is not an allowed edge, including a self-move
// or an unknown key. Unknown input is not echoed.
var ErrTransition = errors.New("stage transition is not allowed")

var keys = [...]string{
	ToRate,
	ToAssess,
	ToInterview,
	Shoot,
	QM,
	ToHire,
	Hired,
	Rejected,
	Withdrawn,
}

var labels = map[string]string{
	ToRate:      "To Rate",
	ToAssess:    "To Assess",
	ToInterview: "To Interview",
	Shoot:       "Shoot",
	QM:          "QM",
	ToHire:      "To Hire",
	Hired:       "Hired",
	Rejected:    "Rejected",
	Withdrawn:   "Withdrawn",
}

// edges is derived from Edges so the map cannot drift from the explicit list.
var edges = map[string]map[string]struct{}{}

var sequence = map[string]int{}

func init() {
	for i, key := range keys {
		sequence[key] = (i + 1) * 10
	}
	for _, pair := range Edges() {
		if edges[pair[0]] == nil {
			edges[pair[0]] = map[string]struct{}{}
		}
		edges[pair[0]][pair[1]] = struct{}{}
	}
}

// Keys returns a copy of the canonical key list, pipeline first and the
// three terminal states last.
func Keys() []string {
	out := make([]string, len(keys))
	copy(out, keys[:])
	return out
}

// Known reports whether key is one of the nine contract keys.
func Known(key string) bool {
	_, ok := labels[key]
	return ok
}

// Label returns the display name for a key. Display names are not accepted
// as transition input.
func Label(key string) (string, bool) {
	label, ok := labels[key]
	return label, ok
}

// Sequence is the hr.recruitment.stage sequence for a key.
func Sequence(key string) (int, bool) {
	n, ok := sequence[key]
	return n, ok
}

// Edges is the explicit allow-list. hired is present only as to_hire -> hired;
// the hire gate adds the contract and DNA checks on top of that edge.
func Edges() [][2]string {
	return [][2]string{
		{ToRate, ToAssess},
		{ToRate, Rejected},
		{ToRate, Withdrawn},
		{ToAssess, ToInterview},
		{ToAssess, Rejected},
		{ToAssess, Withdrawn},
		{ToInterview, Shoot},
		{ToInterview, Rejected},
		{ToInterview, Withdrawn},
		{Shoot, QM},
		{Shoot, Rejected},
		{Shoot, Withdrawn},
		{QM, ToHire},
		{QM, Rejected},
		{QM, Withdrawn},
		{ToHire, Hired},
		{ToHire, Rejected},
		{ToHire, Withdrawn},
	}
}

// Allow reports whether from -> to is an explicit edge.
func Allow(from, to string) error {
	if !Known(from) || !Known(to) {
		return fmt.Errorf("%w: unknown stage", ErrTransition)
	}
	if from == to {
		return fmt.Errorf("%w: %s cannot transition to itself", ErrTransition, from)
	}
	if _, ok := edges[from][to]; !ok {
		return fmt.Errorf("%w: %s -> %s", ErrTransition, from, to)
	}
	return nil
}
