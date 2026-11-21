package qc_test

import (
	"math"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

const baselineBody = `Hello Ada Example,

Your work on the analytical engine compiler stood out. The compiler engineer role on our team is open, and your background is a strong match for the work. If a conversation is useful, reply to this note and we can compare the role with what you want next.

You can unsubscribe at https://example.com/unsubscribe.

Thank you,
Northwind Labs recruiting`

const baselineBodyNoOpt = `Hello Ada Example,

Your work on the analytical engine compiler stood out. The compiler engineer role on our team is open, and your background is a strong match for the work. If a conversation is useful, reply to this note and we can compare the role with what you want next.

Thank you,
Northwind Labs recruiting`

func baseline() qc.Input {
	return qc.Input{
		Draft: qc.Draft{
			Channel: qc.ChannelEmail,
			Subject: "Compiler role at Northwind Labs",
			Body:    baselineBody,
			Claims: []qc.Claim{
				{Text: "analytical engine compiler", Scope: qc.ScopeCandidate},
				{Text: "compiler engineer role", Scope: qc.ScopeNeed},
			},
		},
		Candidate: qc.Candidate{
			Language: "en",
			Facts: []qc.Fact{{
				ID:    "c1",
				Scope: qc.ScopeCandidate,
				Text:  "Ada Example maintains the analytical engine compiler",
			}},
		},
		Need: qc.Need{
			Facts: []qc.Fact{{
				ID:    "n1",
				Scope: qc.ScopeNeed,
				Text:  "The role is a compiler engineer role",
			}},
		},
	}
}

func withBody(in qc.Input, body string) qc.Input {
	in.Draft.Body = body
	return in
}

func withClaims(in qc.Input, claims ...qc.Claim) qc.Input {
	in.Draft.Claims = append([]qc.Claim(nil), claims...)
	return in
}

func padRunes(t *testing.T, base string, n int) string {
	t.Helper()
	have := utf8.RuneCountInString(base)
	if have > n {
		t.Fatalf("base is %d runes, longer than %d", have, n)
	}
	return base + strings.Repeat("a", n-have)
}

func mustPass(t *testing.T, in qc.Input, threshold float64) qc.Verdict {
	t.Helper()
	v, err := qc.Evaluate(in, threshold)
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if v.Status() != qc.StatusPass {
		t.Fatalf("status %s score %v reasons %#v", v.Status(), v.Score(), v.Reasons())
	}
	if v.Score() != 1 {
		t.Fatalf("score %v, want 1", v.Score())
	}
	if v.QCVersion() != "qc.v1" {
		t.Fatalf("qc_version %s", v.QCVersion())
	}
	assertReasons(t, v, nil)
	return v
}

func mustFail(t *testing.T, in qc.Input, threshold float64, failed []string, wantBasis int) qc.Verdict {
	t.Helper()
	v, err := qc.Evaluate(in, threshold)
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if v.Status() != qc.StatusFail {
		t.Fatalf("status %s score %v reasons %#v", v.Status(), v.Score(), v.Reasons())
	}
	if v.QCVersion() != "qc.v1" {
		t.Fatalf("qc_version %s", v.QCVersion())
	}
	if v.Score() < 0 || v.Score() > 1 || math.IsNaN(v.Score()) {
		t.Fatalf("score %v", v.Score())
	}
	got := int(math.Round(v.Score() * 10000))
	if got != wantBasis {
		t.Fatalf("basis %d want %d (score %v)", got, wantBasis, v.Score())
	}
	assertReasons(t, v, failed)
	return v
}

func assertReasons(t *testing.T, v qc.Verdict, failed []string) {
	t.Helper()
	wantOrder := []string{
		qc.CheckGrounding,
		qc.CheckProtected,
		qc.CheckOptOut,
		qc.CheckLength,
		qc.CheckPlaceholder,
		qc.CheckPromises,
		qc.CheckLanguage,
	}
	got := v.Reasons()
	if len(got) != len(wantOrder) {
		t.Fatalf("reasons %d: %#v", len(got), got)
	}
	failSet := map[string]bool{}
	for _, id := range failed {
		failSet[id] = true
	}
	for i, reason := range got {
		if reason.Check != wantOrder[i] {
			t.Fatalf("reason %d = %s, want %s", i, reason.Check, wantOrder[i])
		}
		if reason.Detail == "" {
			t.Fatalf("empty detail for %s", reason.Check)
		}
		if reason.Pass == failSet[reason.Check] {
			t.Fatalf("check %s pass=%v detail=%s", reason.Check, reason.Pass, reason.Detail)
		}
	}
}

func reasonDetail(t *testing.T, v qc.Verdict, check string) string {
	t.Helper()
	for _, reason := range v.Reasons() {
		if reason.Check == check {
			return reason.Detail
		}
	}
	t.Fatalf("missing check %s", check)
	return ""
}
