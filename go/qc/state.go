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

// ErrStaleVerdict is returned when a verdict is not bound to the draft text
// it is being applied to. The draft must be evaluated again.
var ErrStaleVerdict = errors.New("qc: verdict is not bound to this draft")

// ErrCaps is returned when Admit rejects a draft that exceeds a channel cap.
var ErrCaps = errors.New("qc: channel cap")

// Legal transitions:
//
//	Draft     -> QCPending
//	QCPending -> QCPassed
//	QCPending -> QCFailed
//	QCPending -> Draft
//	QCFailed  -> Draft
//	QCFailed  -> QCPending
//	QCPassed  -> Draft
//
// QCPassed returns to Draft when the text is edited. A new pass has to be
// earned again through QCPending. Self-transitions are illegal.
var legalTransitions = map[State]map[State]struct{}{
	StateDraft: {
		StateQCPending: {},
	},
	StateQCPending: {
		StateQCPassed: {},
		StateQCFailed: {},
		StateDraft:    {},
	},
	StateQCFailed: {
		StateDraft:     {},
		StateQCPending: {},
	},
	StateQCPassed: {
		StateDraft: {},
	},
}

// Transition reports whether from -> to is a legal QC state change.
func Transition(from, to State) error {
	if next, ok := legalTransitions[from]; ok {
		if _, ok := next[to]; ok {
			return nil
		}
	}
	return fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
}

// Apply moves a QCPending message to QCPassed or QCFailed from the verdict
// status. It does not re-score the draft. The verdict must be bound to draft.
// Any other source state, a nil verdict, or a status other than PASS or FAIL
// is rejected.
func Apply(from State, draft Draft, v Verdict) (State, error) {
	if v == nil {
		return "", ErrVerdict
	}
	var to State
	switch v.Status() {
	case StatusPass:
		to = StateQCPassed
	case StatusFail:
		to = StateQCFailed
	default:
		return "", ErrVerdict
	}
	if v.DraftHash() == "" || v.DraftHash() != DraftHash(draft) {
		return "", ErrStaleVerdict
	}
	if err := Transition(from, to); err != nil {
		return "", err
	}
	return to, nil
}
