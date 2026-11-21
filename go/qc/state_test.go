package qc_test

import (
	"errors"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

func TestTransitions(t *testing.T) {
	states := []qc.State{qc.StateDraft, qc.StateQCPending, qc.StateQCPassed, qc.StateQCFailed}
	legal := map[qc.State]map[qc.State]bool{
		qc.StateDraft:     {qc.StateQCPending: true},
		qc.StateQCPending: {qc.StateQCPassed: true, qc.StateQCFailed: true, qc.StateDraft: true},
		qc.StateQCFailed:  {qc.StateDraft: true, qc.StateQCPending: true},
		qc.StateQCPassed:  {qc.StateDraft: true},
	}
	for _, from := range states {
		for _, to := range states {
			err := qc.Transition(from, to)
			want := legal[from][to]
			if want && err != nil {
				t.Errorf("%s -> %s rejected: %v", from, to, err)
			}
			if !want && !errors.Is(err, qc.ErrIllegalTransition) {
				t.Errorf("%s -> %s err=%v, want ErrIllegalTransition", from, to, err)
			}
		}
	}
	for _, state := range []qc.State{"", "draft", "QCPassed ", "pending"} {
		if err := qc.Transition(qc.StateDraft, state); !errors.Is(err, qc.ErrIllegalTransition) {
			t.Errorf("Draft -> %q err=%v", state, err)
		}
		if err := qc.Transition(state, qc.StateQCPending); !errors.Is(err, qc.ErrIllegalTransition) {
			t.Errorf("%q -> QCPending err=%v", state, err)
		}
	}
}

type scriptedVerdict struct {
	status  qc.Status
	score   float64
	version string
	reasons []qc.Reason
}

func (s scriptedVerdict) Status() qc.Status { return s.status }
func (s scriptedVerdict) Score() float64    { return s.score }
func (s scriptedVerdict) QCVersion() string { return s.version }
func (s scriptedVerdict) Reasons() []qc.Reason {
	return append([]qc.Reason(nil), s.reasons...)
}

func TestApply(t *testing.T) {
	pass := scriptedVerdict{status: qc.StatusPass, score: 1, version: qc.QCVersion}
	fail := scriptedVerdict{status: qc.StatusFail, score: 0.8, version: qc.QCVersion}
	cases := []struct {
		name string
		from qc.State
		v    qc.Verdict
		want qc.State
		ok   bool
	}{
		{"pending pass", qc.StateQCPending, pass, qc.StateQCPassed, true},
		{"pending fail", qc.StateQCPending, fail, qc.StateQCFailed, true},
		{"draft pass", qc.StateDraft, pass, "", false},
		{"draft fail", qc.StateDraft, fail, "", false},
		{"passed pass", qc.StateQCPassed, pass, "", false},
		{"passed fail", qc.StateQCPassed, fail, "", false},
		{"failed pass", qc.StateQCFailed, pass, "", false},
		{"failed fail", qc.StateQCFailed, fail, "", false},
		{"empty status", qc.StateQCPending, scriptedVerdict{}, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := qc.Apply(tc.from, tc.v)
			if tc.ok {
				if err != nil || got != tc.want {
					t.Fatalf("got %s err %v", got, err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected an error")
			}
			if tc.name == "empty status" {
				if !errors.Is(err, qc.ErrVerdict) {
					t.Fatal(err)
				}
				return
			}
			if !errors.Is(err, qc.ErrIllegalTransition) {
				t.Fatal(err)
			}
		})
	}
	var none qc.Verdict
	if _, err := qc.Apply(qc.StateQCPending, none); !errors.Is(err, qc.ErrVerdict) {
		t.Fatal(err)
	}
}

func TestApplyEvaluate(t *testing.T) {
	pass, err := qc.Evaluate(baseline(), 0.9)
	if err != nil {
		t.Fatal(err)
	}
	next, err := qc.Apply(qc.StateQCPending, pass)
	if err != nil || next != qc.StateQCPassed {
		t.Fatalf("pass -> %s %v", next, err)
	}
	fail, err := qc.Evaluate(withBody(baseline(), baselineBodyNoOpt), 0.9)
	if err != nil {
		t.Fatal(err)
	}
	next, err = qc.Apply(qc.StateQCPending, fail)
	if err != nil || next != qc.StateQCFailed {
		t.Fatalf("fail -> %s %v", next, err)
	}
	if _, err := qc.Apply(qc.StateDraft, pass); !errors.Is(err, qc.ErrIllegalTransition) {
		t.Fatal(err)
	}
}
