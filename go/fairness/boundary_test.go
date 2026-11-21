package fairness_test

import (
	"math"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

// The EEOC four-fifths rule treats a rate less than 80 percent of the highest
// rate as adverse impact. Exactly 80 percent is not adverse impact. These
// tests pin that boundary with integer counts so a float comparison cannot
// move it.

func TestSpecBoundaryExactlyFourFifthsIsNotAdverseImpact(t *testing.T) {
	rep := mustAudit(t, ratioRun(20, 20, 20, 16), fairness.Options{MinGroupSize: 10})
	row := fourFifths(t, rep, "declared-b")
	if math.Abs(row.Ratio-0.8) > 1e-12 {
		t.Fatalf("ratio=%v want 0.8", row.Ratio)
	}
	if row.AdverseImpact {
		t.Fatal("exactly 4/5 must not be adverse impact")
	}
	if row.Verdict != fairness.VerdictWarn {
		t.Fatalf("exactly 4/5 is inside the review band, verdict=%s", row.Verdict)
	}
	if row.Verdict == fairness.VerdictFail {
		t.Fatal("exactly 4/5 must not fail")
	}
	ref := fourFifths(t, rep, "declared-a")
	if ref.AdverseImpact || math.Abs(ref.Ratio-1) > 1e-12 || ref.Verdict != fairness.VerdictPass {
		t.Fatalf("reference row = %+v", ref)
	}
	if checkNamed(t, rep, fairness.CheckParity).Verdict != fairness.VerdictWarn {
		t.Fatal("parity check should warn on the 4/5 boundary")
	}
}

func TestSpecBoundaryExactlyFourFifthsWhenReferenceRateIsNotOne(t *testing.T) {
	// 8/20 over 10/20 is exactly 4/5, and the reference rate is 1/2.
	rep := mustAudit(t, ratioRun(20, 10, 20, 8), fairness.Options{MinGroupSize: 10})
	row := fourFifths(t, rep, "declared-b")
	if math.Abs(row.Ratio-0.8) > 1e-12 {
		t.Fatalf("ratio=%v want 0.8", row.Ratio)
	}
	if row.ReferenceRate != 0.5 {
		t.Fatalf("reference rate=%v", row.ReferenceRate)
	}
	if row.AdverseImpact {
		t.Fatal("exactly 4/5 must not be adverse impact")
	}
	if row.Verdict != fairness.VerdictWarn {
		t.Fatalf("verdict=%s want Warn", row.Verdict)
	}
}

func TestSpecBoundaryJustBelowFourFifthsFails(t *testing.T) {
	rep := mustAudit(t, ratioRun(20, 20, 20, 15), fairness.Options{MinGroupSize: 10})
	row := fourFifths(t, rep, "declared-b")
	if !row.AdverseImpact {
		t.Fatal("15/20 over 20/20 is adverse impact")
	}
	if row.Verdict != fairness.VerdictFail {
		t.Fatalf("verdict=%s want Fail", row.Verdict)
	}
	if math.Abs(row.Ratio-0.75) > 1e-12 {
		t.Fatalf("ratio=%v want 0.75", row.Ratio)
	}
}

func TestSpecBoundaryJustBelowFourFifthsWhenReferenceRateIsNotOne(t *testing.T) {
	rep := mustAudit(t, ratioRun(20, 10, 20, 7), fairness.Options{MinGroupSize: 10})
	row := fourFifths(t, rep, "declared-b")
	if !row.AdverseImpact || row.Verdict != fairness.VerdictFail {
		t.Fatalf("row=%+v", row)
	}
}

func TestSpecBoundaryExactlyNineTenthsPasses(t *testing.T) {
	rep := mustAudit(t, ratioRun(20, 20, 20, 18), fairness.Options{MinGroupSize: 10})
	row := fourFifths(t, rep, "declared-b")
	if math.Abs(row.Ratio-0.9) > 1e-12 {
		t.Fatalf("ratio=%v want 0.9", row.Ratio)
	}
	if row.AdverseImpact || row.Verdict != fairness.VerdictPass {
		t.Fatalf("row=%+v", row)
	}
}

func TestSpecBoundaryBetweenFourFifthsAndNineTenthsWarns(t *testing.T) {
	rep := mustAudit(t, ratioRun(20, 20, 20, 17), fairness.Options{MinGroupSize: 10})
	row := fourFifths(t, rep, "declared-b")
	if row.AdverseImpact {
		t.Fatal("17/20 is not adverse impact")
	}
	if row.Verdict != fairness.VerdictWarn {
		t.Fatalf("verdict=%s want Warn", row.Verdict)
	}
}

func TestNoDisparityVerdictBelowMinimumGroupSize(t *testing.T) {
	// The same 15/20 gap would fail at a large sample. It must not fail here.
	rep := mustAudit(t, ratioRun(20, 20, 20, 15), fairness.Options{MinGroupSize: 30})
	row := fourFifths(t, rep, "declared-b")
	if row.Verdict != fairness.VerdictInsufficient {
		t.Fatalf("verdict=%s want Insufficient", row.Verdict)
	}
	if row.AdverseImpact {
		t.Fatal("a small sample must not carry an adverse-impact verdict")
	}
	if !row.RatioDefined {
		t.Fatal("the descriptive ratio should still be present")
	}
	if row.Warning == "" || !containsAll(row.Warning, "below minimum", "not a verdict") {
		t.Fatalf("warning=%q", row.Warning)
	}
	if checkNamed(t, rep, fairness.CheckParity).Verdict == fairness.VerdictFail {
		t.Fatal("parity check must not fail below the minimum group size")
	}
}

func TestNoVerdictWhenReferenceGroupIsBelowMinimum(t *testing.T) {
	// Two selected people at rate 1 must not be the reference that fails a
	// group of 40 whose rate is 0.5.
	run := ratioRun(2, 2, 40, 20)
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 30})
	small := fourFifths(t, rep, "declared-a")
	large := fourFifths(t, rep, "declared-b")
	if small.Verdict != fairness.VerdictInsufficient || small.AdverseImpact {
		t.Fatalf("small=%+v", small)
	}
	if large.Verdict != fairness.VerdictInsufficient || large.AdverseImpact {
		t.Fatalf("large=%+v", large)
	}
	if large.Warning == "" || !containsAll(large.Warning, "not a verdict") {
		t.Fatalf("warning=%q", large.Warning)
	}
	if rep.Verdict == fairness.VerdictFail {
		t.Fatal("overall verdict must not fail when the reference group is too small")
	}
}

func TestZeroSelectionRateIsInsufficientNotADivideByZero(t *testing.T) {
	run := fairness.Run{
		RunID:           "synthetic-none-selected",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates: []fairness.Candidate{
			candidate("a-00", 2, "declared-a", true),
			candidate("b-00", 3, "declared-b", true),
		},
	}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1})
	for _, row := range rep.FourFifths {
		if row.RatioDefined || row.AdverseImpact || row.Verdict != fairness.VerdictInsufficient {
			t.Fatalf("row=%+v", row)
		}
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !stringsContains(s, p) {
			return false
		}
	}
	return true
}

func stringsContains(s, part string) bool {
	return len(part) == 0 || (len(s) >= len(part) && (s == part || len(s) > 0 && containsFrom(s, part)))
}

func containsFrom(s, part string) bool {
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return true
		}
	}
	return false
}
