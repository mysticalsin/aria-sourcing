package qc

import (
	"errors"
	"fmt"
)

// ErrIllegalTransition is returned for a state change the machine does not allow.
var ErrIllegalTransition = errors.New("qc: illegal state transition")

// ErrVerdict is returned when Apply is given no verdict or a verdict whose
// status is neither PASS nor FAIL.
var ErrVerdict = errors.New("qc: invalid verdict")

// ErrThreshold is returned when a threshold is outside [0, 1] or is not a
// plain decimal.
var ErrThreshold = errors.New("qc: invalid threshold")

// EnvQCPassThreshold is the process environment key for the pass threshold.
const EnvQCPassThreshold = "ARIA_QC_PASS_THRESHOLD"

// DefaultThreshold is intentionally unset in this stub.
const DefaultThreshold = 0

var errNotImplemented = errors.New("qc: not implemented")

// ThresholdFrom is the red stub. It does not parse ARIA_QC_PASS_THRESHOLD.
func ThresholdFrom(func(string) string) (float64, error) {
	return 0, errNotImplemented
}

// LoadThreshold is the red stub. It does not read the process environment.
func LoadThreshold() (float64, error) {
	return 0, errNotImplemented
}

// Transition is the red stub. Every change is reported as unimplemented.
func Transition(from, to State) error {
	return fmt.Errorf("%w: %s -> %s", errNotImplemented, from, to)
}

// Apply is the red stub. It does not move a message between QC states.
func Apply(State, Verdict) (State, error) {
	return "", errNotImplemented
}

// Evaluate is the red stub. It does not score the draft.
func Evaluate(Input, float64) (Result, error) {
	return Result{version: "stub"}, nil
}
