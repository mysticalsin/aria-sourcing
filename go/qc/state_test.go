package qc_test

import (
	"errors"
	"strings"
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
	hash    string
}

func (s scriptedVerdict) Status() qc.Status { return s.status }
func (s scriptedVerdict) Score() float64    { return s.score }
func (s scriptedVerdict) QCVersion() string { return s.version }
func (s scriptedVerdict) DraftHash() string { return s.hash }
func (s scriptedVerdict) Reasons() []qc.Reason {
	return append([]qc.Reason(nil), s.reasons...)
}

func TestApply(t *testing.T) {
	draft := baseline().Draft
	pass := scriptedVerdict{status: qc.StatusPass, score: 1, version: qc.QCVersion, hash: qc.DraftHash(draft)}
	fail := scriptedVerdict{status: qc.StatusFail, score: 0.8, version: qc.QCVersion, hash: qc.DraftHash(draft)}
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
			got, err := qc.Apply(tc.from, draft, tc.v)
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
	if _, err := qc.Apply(qc.StateQCPending, draft, none); !errors.Is(err, qc.ErrVerdict) {
		t.Fatal(err)
	}
}

func TestApplyEvaluate(t *testing.T) {
	good := baseline()
	pass, err := qc.Evaluate(good, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	next, err := qc.Apply(qc.StateQCPending, good.Draft, pass)
	if err != nil || next != qc.StateQCPassed {
		t.Fatalf("pass -> %s %v", next, err)
	}
	bad := withBody(good, baselineBodyNoOpt)
	fail, err := qc.Evaluate(bad, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	next, err = qc.Apply(qc.StateQCPending, bad.Draft, fail)
	if err != nil || next != qc.StateQCFailed {
		t.Fatalf("fail -> %s %v", next, err)
	}
	if _, err := qc.Apply(qc.StateDraft, good.Draft, pass); !errors.Is(err, qc.ErrIllegalTransition) {
		t.Fatal(err)
	}
}

func TestStalePassDoesNotPromoteEditedDraft(t *testing.T) {
	good := baseline()
	pass, err := qc.Evaluate(good, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	if pass.DraftHash() == "" || pass.DraftHash() != qc.DraftHash(good.Draft) {
		t.Fatalf("verdict hash %q is not the draft hash %q", pass.DraftHash(), qc.DraftHash(good.Draft))
	}
	edited := withBody(good, baselineBodyNoOpt)
	if qc.DraftHash(edited.Draft) == pass.DraftHash() {
		t.Fatal("an edit left the draft hash unchanged")
	}
	if err := qc.Transition(qc.StateQCFailed, qc.StateQCPending); err != nil {
		t.Fatal(err)
	}
	next, err := qc.Apply(qc.StateQCPending, edited.Draft, pass)
	if !errors.Is(err, qc.ErrStaleVerdict) || next == qc.StateQCPassed {
		t.Fatalf("QCFailed -> QCPending -> %s with a stale PASS, err=%v", next, err)
	}
	fresh, err := qc.Evaluate(edited, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Status() != qc.StatusFail {
		t.Fatalf("edited draft status %s", fresh.Status())
	}
	next, err = qc.Apply(qc.StateQCPending, edited.Draft, fresh)
	if err != nil || next != qc.StateQCFailed {
		t.Fatalf("fresh fail -> %s %v", next, err)
	}
	next, err = qc.Apply(qc.StateQCPending, good.Draft, pass)
	if err != nil || next != qc.StateQCPassed {
		t.Fatalf("matching pass -> %s %v", next, err)
	}
}

func TestAdmitRejectsOverCapPass(t *testing.T) {
	draft := baseline().Draft
	draft.Body = strings.Repeat("a", qc.EmailBodyMax+1)
	verdict := scriptedVerdict{
		status:  qc.StatusPass,
		score:   1,
		version: qc.QCVersion,
		hash:    qc.DraftHash(draft),
	}
	if err := qc.Admit(draft, verdict); err == nil || !errors.Is(err, qc.ErrCaps) {
		t.Fatalf("over-cap PASS admitted: %v", err)
	}
	good := baseline()
	pass, err := qc.Evaluate(good, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	if err := qc.Admit(good.Draft, pass); err != nil {
		t.Fatal(err)
	}
}
