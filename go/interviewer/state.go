package interviewer

import "fmt"

// State is the hand-off lifecycle. Names are the wire values callers persist.
type State string

const (
	StateNotRequested State = "NotRequested"
	StateRequested    State = "Requested"
	StateInProgress   State = "InProgress"
	StateCompleted    State = "Completed"
	StateFailed       State = "Failed"
	StateExpired      State = "Expired"
)

// Transition reports whether moving from one state to another is legal.
// Staying in the same state is an idempotent observation. Terminal states
// do not move backwards. NotRequested only advances to Requested; a later
// state is reached by a second legal step after the interviewer accepts.
func Transition(from, to State) error {
	if !knownState(from) || !knownState(to) {
		return fmt.Errorf("%w: %s -> %s", ErrTransition, from, to)
	}
	if from == to {
		return nil
	}
	ok := false
	switch from {
	case StateNotRequested:
		ok = to == StateRequested
	case StateRequested:
		ok = to == StateInProgress || to == StateCompleted || to == StateFailed || to == StateExpired
	case StateInProgress:
		ok = to == StateCompleted || to == StateFailed || to == StateExpired
	}
	if !ok {
		return fmt.Errorf("%w: %s -> %s", ErrTransition, from, to)
	}
	return nil
}

func knownState(s State) bool {
	switch s {
	case StateNotRequested, StateRequested, StateInProgress, StateCompleted, StateFailed, StateExpired:
		return true
	default:
		return false
	}
}

// StateFromRemote maps an interviewer status onto the hand-off state.
// Live interview statuses (planned, active, completed, abandoned) and the
// screening façade statuses are both accepted. The match is case-sensitive.
func StateFromRemote(status string) (State, error) {
	switch status {
	case "requested", "planned":
		return StateRequested, nil
	case "in_progress", "active":
		return StateInProgress, nil
	case "completed":
		return StateCompleted, nil
	case "failed", "abandoned":
		return StateFailed, nil
	case "expired":
		return StateExpired, nil
	default:
		return "", fmt.Errorf("%w: status %q", ErrValidation, status)
	}
}
