package router

import "fmt"

// State is one step of a routed request. The legal edges are the product
// state machine; Route never moves outside this table.
type State string

const (
	StateReceived       State = "received"
	StateRuleHit        State = "rule_hit"
	StateSmallModel     State = "small_model"
	StateEscalated      State = "escalated"
	StateBigModel       State = "big_model"
	StateCached         State = "cached"
	StateDone           State = "done"
	StateBudgetExceeded State = "budget_exceeded"
)

// legal is the explicit transition table.
//
//	received -> rule_hit | small_model | cached | budget_exceeded
//	rule_hit -> cached | done
//	small_model -> escalated | cached | done | budget_exceeded
//	escalated -> big_model | budget_exceeded
//	big_model -> cached | done | budget_exceeded
//	cached -> done
var legal = map[State]map[State]bool{
	StateReceived: {
		StateRuleHit:        true,
		StateSmallModel:     true,
		StateCached:         true,
		StateBudgetExceeded: true,
	},
	StateRuleHit: {
		StateCached: true,
		StateDone:   true,
	},
	StateSmallModel: {
		StateEscalated:      true,
		StateCached:         true,
		StateDone:           true,
		StateBudgetExceeded: true,
	},
	StateEscalated: {
		StateBigModel:       true,
		StateBudgetExceeded: true,
	},
	StateBigModel: {
		StateCached:         true,
		StateDone:           true,
		StateBudgetExceeded: true,
	},
	StateCached: {
		StateDone: true,
	},
}

// Machine tracks one request. It starts in received.
type Machine struct {
	state State
	trace []State
}

// NewMachine starts a request in received.
func NewMachine() *Machine {
	return &Machine{state: StateReceived, trace: []State{StateReceived}}
}

// State returns the current state.
func (m *Machine) State() State { return m.state }

// Trace returns a copy of the states visited, including received.
func (m *Machine) Trace() []State {
	out := make([]State, len(m.trace))
	copy(out, m.trace)
	return out
}

// Transition moves to next when the edge is legal.
func (m *Machine) Transition(next State) error {
	if m == nil {
		return fmt.Errorf("nil state machine")
	}
	allowed := legal[m.state]
	if !allowed[next] {
		return fmt.Errorf("illegal router transition %s -> %s", m.state, next)
	}
	m.state = next
	m.trace = append(m.trace, next)
	return nil
}
