package fairness_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

func TestInterleavedRanksPass(t *testing.T) {
	rep := mustAudit(t, interleavedRun(), fairness.Options{MinGroupSize: 10})
	if rep.Verdict != fairness.VerdictPass {
		t.Fatalf("verdict=%s warnings=%v", rep.Verdict, rep.Warnings)
	}
	if checkNamed(t, rep, fairness.CheckParity).Verdict != fairness.VerdictPass {
		t.Fatal("parity")
	}
	row := exposureRow(t, rep, "declared-b")
	if row.Gap > fairness.ExposureWarnGap {
		t.Fatalf("fixture gap %v exceeds warn threshold", row.Gap)
	}
	if row.Verdict != fairness.VerdictPass {
		t.Fatalf("exposure verdict=%s gap=%v ratio=%v", row.Verdict, row.Gap, row.Ratio)
	}
	if rep.Counterfactual.Ran {
		t.Fatal("nil scorer must not run counterfactuals")
	}
	if rep.Counterfactual.Verdict != fairness.VerdictInsufficient {
		t.Fatalf("counterfactual verdict=%s", rep.Counterfactual.Verdict)
	}
}

func TestNilScorerDoesNotBlockPass(t *testing.T) {
	rep := mustAudit(t, interleavedRun(), fairness.Options{MinGroupSize: 10, Scorer: nil})
	if rep.Verdict != fairness.VerdictPass {
		t.Fatalf("verdict=%s", rep.Verdict)
	}
	if checkNamed(t, rep, fairness.CheckCounterfactual).Verdict != fairness.VerdictInsufficient {
		t.Fatal("unrun counterfactual should be Insufficient and excluded from the overall verdict")
	}
}

func TestSeparatedExposureAndSelectionFail(t *testing.T) {
	rep := mustAudit(t, separatedRun(), fairness.Options{MinGroupSize: 10})
	exp := exposureRow(t, rep, "declared-b")
	if exp.Verdict != fairness.VerdictFail || exp.Ratio >= 0.8 {
		t.Fatalf("exposure=%+v", exp)
	}
	ff := fourFifths(t, rep, "declared-b")
	if !ff.AdverseImpact || ff.Verdict != fairness.VerdictFail {
		t.Fatalf("four-fifths=%+v", ff)
	}
	if rep.Verdict != fairness.VerdictFail {
		t.Fatalf("verdict=%s", rep.Verdict)
	}
	if rep.AutoReject {
		t.Fatal("a failing audit still must not auto-reject")
	}
}

func TestExposureSmallSampleIsInsufficient(t *testing.T) {
	rep := mustAudit(t, separatedRun(), fairness.Options{MinGroupSize: 30})
	exp := exposureRow(t, rep, "declared-b")
	if exp.Verdict != fairness.VerdictInsufficient || exp.Warning == "" {
		t.Fatalf("exposure=%+v", exp)
	}
	if checkNamed(t, rep, fairness.CheckExposure).Verdict == fairness.VerdictFail {
		t.Fatal("exposure check failed on a small sample")
	}
}

func TestInvariantScorerPassesCounterfactual(t *testing.T) {
	rep := mustAudit(t, interleavedRun(), fairness.Options{MinGroupSize: 10, Epsilon: 1e-6, Scorer: invariantScorer{}})
	if rep.Counterfactual.Verdict != fairness.VerdictPass || rep.Verdict != fairness.VerdictPass {
		t.Fatalf("overall=%s cf=%+v", rep.Verdict, rep.Counterfactual)
	}
}

func TestBiasedScorerFailsCounterfactualAndDoesNotAutoReject(t *testing.T) {
	rep := mustAudit(t, interleavedRun(), fairness.Options{MinGroupSize: 10, Scorer: biasedScorer{}})
	if rep.Counterfactual.Verdict != fairness.VerdictFail || rep.Verdict != fairness.VerdictFail {
		t.Fatalf("overall=%s cf=%s", rep.Verdict, rep.Counterfactual.Verdict)
	}
	if rep.AutoReject || !rep.HumanDecisionRequired {
		t.Fatal("bias finding must stay a human decision")
	}
	saw := false
	for _, c := range rep.Counterfactual.Cases {
		if !c.Within {
			saw = true
		}
	}
	if !saw {
		t.Fatal("expected a swap outside epsilon")
	}
}

func TestCounterfactualDeltaEqualToEpsilonPasses(t *testing.T) {
	const eps = 0.25
	scorer := fnScorer{fn: func(v fairness.ScoreView) (float64, error) {
		if strings.Contains(v.Text, "[name:alan]") || strings.Contains(v.Text, "[marker:he]") {
			return 1 + eps, nil
		}
		return 1, nil
	}}
	run := fairness.Run{
		RunID:           "synthetic-epsilon",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{candidate("only", 1, "declared-a", true)},
	}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1, Epsilon: eps, Scorer: scorer})
	if rep.Counterfactual.Verdict != fairness.VerdictPass {
		t.Fatalf("delta == epsilon must pass: %+v", rep.Counterfactual)
	}
	if len(rep.Counterfactual.Cases) < 2 {
		t.Fatalf("want name and gender-marker swaps, got %+v", rep.Counterfactual.Cases)
	}
}

func TestCounterfactualDeltaAboveEpsilonFails(t *testing.T) {
	const eps = 0.25
	scorer := fnScorer{fn: func(v fairness.ScoreView) (float64, error) {
		if strings.Contains(v.Text, "[name:alan]") || strings.Contains(v.Text, "[marker:he]") {
			return 1 + eps + 1e-6, nil
		}
		return 1, nil
	}}
	run := fairness.Run{
		RunID:           "synthetic-epsilon-over",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{candidate("only", 1, "declared-a", true)},
	}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1, Epsilon: eps, Scorer: scorer})
	if rep.Counterfactual.Verdict != fairness.VerdictFail {
		t.Fatalf("verdict=%s", rep.Counterfactual.Verdict)
	}
}

func TestScorerDoesNotReceiveProtectedLabel(t *testing.T) {
	const hidden = "label-value-not-a-feature"
	c := candidate("only", 1, "declared-a", true)
	c.ProtectedGroup.Value = hidden
	spy := &spyScorer{}
	run := fairness.Run{RunID: "synthetic-spy", Seed: 1, SelectionCutoff: 1, Candidates: []fairness.Candidate{c}}
	mustAudit(t, run, fairness.Options{MinGroupSize: 1, Scorer: spy})
	if len(spy.views) == 0 {
		t.Fatal("scorer was not called")
	}
	for _, v := range spy.views {
		if strings.Contains(v.Text, hidden) {
			t.Fatalf("label leaked into text %q", v.Text)
		}
		for k, val := range v.Features {
			if strings.EqualFold(k, "protectedGroup") || strings.Contains(k, "protected") {
				t.Fatalf("feature key %s", k)
			}
			if s, ok := val.(string); ok && strings.Contains(s, hidden) {
				t.Fatalf("label leaked into feature %s", k)
			}
		}
	}
}

func TestSwappingOnlyTheLabelDoesNotChangeScoreInputs(t *testing.T) {
	base := interleavedRun()
	spyA := &spyScorer{}
	spyB := &spyScorer{}
	mustAudit(t, base, fairness.Options{MinGroupSize: 10, Scorer: spyA})
	other := base
	other.Candidates = append([]fairness.Candidate(nil), base.Candidates...)
	for i := range other.Candidates {
		c := other.Candidates[i]
		label := *c.ProtectedGroup
		if label.Value == "declared-a" {
			label.Value = "declared-b"
		} else {
			label.Value = "declared-a"
		}
		c.ProtectedGroup = &label
		other.Candidates[i] = c
	}
	mustAudit(t, other, fairness.Options{MinGroupSize: 10, Scorer: spyB})
	if len(spyA.views) == 0 || len(spyA.views) != len(spyB.views) {
		t.Fatalf("views %d vs %d", len(spyA.views), len(spyB.views))
	}
	for i := range spyA.views {
		if spyA.views[i].ID != spyB.views[i].ID || spyA.views[i].Text != spyB.views[i].Text {
			t.Fatalf("view %d changed %#v vs %#v", i, spyA.views[i], spyB.views[i])
		}
		if len(spyA.views[i].Features) != len(spyB.views[i].Features) {
			t.Fatal("feature count changed")
		}
		for k, v := range spyA.views[i].Features {
			if spyB.views[i].Features[k] != v {
				t.Fatalf("feature %s changed", k)
			}
		}
	}
}

func TestScorerErrorIsReturned(t *testing.T) {
	scorer := fnScorer{fn: func(fairness.ScoreView) (float64, error) {
		return 0, errors.New("boom")
	}}
	run := fairness.Run{
		RunID:           "synthetic-score-error",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{candidate("only", 1, "declared-a", true)},
	}
	_, err := fairness.Audit(run, fairness.Options{Scorer: scorer})
	if err == nil || !strings.Contains(err.Error(), "boom") || !strings.Contains(err.Error(), "only") {
		t.Fatalf("err=%v", err)
	}
}

func TestNonConsentedLabelIsDiscarded(t *testing.T) {
	var cs []fairness.Candidate
	for i := 0; i < 20; i++ {
		cs = append(cs, candidate(pid("a", i), i+1, "declared-a", true))
		cs = append(cs, candidate(pid("b", i), 21+i, "declared-b", true))
	}
	for i := 0; i < 10; i++ {
		c := candidate(pid("c", i), 41+i, "declared-c", false)
		cs = append(cs, c)
	}
	for i := 10; i < 20; i++ {
		c := candidate(pid("c", i), 41+i, "declared-c", true)
		c.ProtectedGroup.SelfDeclared = false
		cs = append(cs, c)
	}
	run := fairness.Run{RunID: "synthetic-consent", Seed: 1, SelectionCutoff: 40, Candidates: cs}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 10})
	if rep.DiscardedLabels != 20 {
		t.Fatalf("discarded=%d", rep.DiscardedLabels)
	}
	if len(rep.FourFifths) != 2 {
		t.Fatalf("groups=%d", len(rep.FourFifths))
	}
	for _, row := range rep.FourFifths {
		if row.Group == "declared-c" || row.SelectionRate != 1 || row.Verdict != fairness.VerdictPass {
			t.Fatalf("row=%+v", row)
		}
	}
	joined := strings.Join(rep.Warnings, "\n")
	if !strings.Contains(joined, "discarded") || !strings.Contains(joined, "c-00") {
		t.Fatalf("warnings=%v", rep.Warnings)
	}
}

func TestProxyFeaturesAreFlagged(t *testing.T) {
	a := candidate("a", 1, "declared-a", true)
	a.Features["postcode"] = "SYN-000"
	a.Features["graduationYear"] = 2014.0
	a.Features["photoPresent"] = true
	b := candidate("b", 2, "declared-b", true)
	b.Features["postalCode"] = "SYN-001"
	b.Features["graduation_year"] = 2016
	b.Features["photo"] = "synthetic-photo"
	clean := candidate("c", 3, "declared-a", true)
	clean.Features["photoPresent"] = false
	clean.Features["postcode"] = ""
	run := fairness.Run{RunID: "synthetic-proxy", Seed: 1, SelectionCutoff: 3, Candidates: []fairness.Candidate{a, b, clean}}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1})
	if checkNamed(t, rep, fairness.CheckProxies).Verdict != fairness.VerdictWarn {
		t.Fatal("proxy check should warn")
	}
	got := map[string]fairness.ProxyFlag{}
	for _, f := range rep.Proxies {
		got[f.Feature] = f
	}
	for _, name := range []string{"postcode", "graduationYear", "photo"} {
		f, ok := got[name]
		if !ok {
			t.Fatalf("missing %s in %+v", name, rep.Proxies)
		}
		if len(f.CandidateIDs) == 0 || f.Reason == "" {
			t.Fatalf("flag %+v", f)
		}
	}
	if reason := got["graduationYear"].Reason; !strings.Contains(reason, "age") {
		t.Fatalf("reason=%q", reason)
	}
	if reason := got["postcode"].Reason; !strings.Contains(reason, "proxy") {
		t.Fatalf("reason=%q", reason)
	}
	if ids := got["postcode"].CandidateIDs; len(ids) != 2 || ids[0] != "a" || ids[1] != "b" {
		t.Fatalf("postcode ids=%v", ids)
	}
	for _, id := range got["photo"].CandidateIDs {
		if id == "c" {
			t.Fatal("a false photoPresent must not be flagged")
		}
	}
}

func TestProxyWarnOutranksInsufficientSample(t *testing.T) {
	run := ratioRun(20, 20, 20, 15)
	run.Candidates[0].Features["zip"] = "SYN-000"
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 30})
	if checkNamed(t, rep, fairness.CheckParity).Verdict != fairness.VerdictInsufficient {
		t.Fatal("parity should stay Insufficient")
	}
	if rep.Verdict != fairness.VerdictWarn {
		t.Fatalf("verdict=%s want Warn", rep.Verdict)
	}
}

func TestMissingReasonsFail(t *testing.T) {
	run := interleavedRun()
	run.Candidates[3].Reasons = nil
	run.Candidates[4].Reasons = []string{"  "}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 10})
	ex := rep.Explanations
	if ex.Complete || ex.Verdict != fairness.VerdictFail {
		t.Fatalf("explanations=%+v", ex)
	}
	if !slicesHas(ex.MissingIDs, run.Candidates[3].ID) || !slicesHas(ex.MissingIDs, run.Candidates[4].ID) {
		t.Fatalf("missing=%v", ex.MissingIDs)
	}
	if rep.Verdict != fairness.VerdictFail || rep.AutoReject {
		t.Fatalf("verdict=%s autoReject=%v", rep.Verdict, rep.AutoReject)
	}
}

func TestMissingReasonsFailOutranksProxyWarn(t *testing.T) {
	run := interleavedRun()
	run.Candidates[0].Reasons = nil
	run.Candidates[1].Features["postcode"] = "SYN-000"
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 10})
	if rep.Verdict != fairness.VerdictFail {
		t.Fatalf("verdict=%s", rep.Verdict)
	}
}

func TestSingleGroupIsInsufficient(t *testing.T) {
	run := fairness.Run{
		RunID:           "synthetic-one-group",
		Seed:            1,
		SelectionCutoff: 2,
		Candidates: []fairness.Candidate{
			candidate("a-00", 1, "declared-a", true),
			candidate("a-01", 2, "declared-a", true),
		},
	}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1})
	if checkNamed(t, rep, fairness.CheckParity).Verdict != fairness.VerdictInsufficient {
		t.Fatal("one group cannot show parity")
	}
}

func TestDuplicateRankIsRejected(t *testing.T) {
	run := fairness.Run{
		RunID:           "synthetic-dup-rank",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates: []fairness.Candidate{
			candidate("a", 1, "declared-a", true),
			candidate("b", 1, "declared-b", true),
		},
	}
	_, err := fairness.Audit(run, fairness.Options{})
	if err == nil || !strings.Contains(err.Error(), "duplicate rank") {
		t.Fatalf("err=%v", err)
	}
}

func TestDuplicateIDIsRejected(t *testing.T) {
	run := fairness.Run{
		RunID:           "synthetic-dup-id",
		Seed:            1,
		SelectionCutoff: 2,
		Candidates: []fairness.Candidate{
			candidate("a", 1, "declared-a", true),
			candidate("a", 2, "declared-b", true),
		},
	}
	_, err := fairness.Audit(run, fairness.Options{})
	if err == nil || !strings.Contains(err.Error(), "duplicate id") {
		t.Fatalf("err=%v", err)
	}
}

func TestBadRankIsRejected(t *testing.T) {
	c := candidate("a", 0, "declared-a", true)
	run := fairness.Run{RunID: "synthetic-rank", Seed: 1, SelectionCutoff: 1, Candidates: []fairness.Candidate{c}}
	_, err := fairness.Audit(run, fairness.Options{})
	if err == nil || !strings.Contains(err.Error(), "rank") {
		t.Fatalf("err=%v", err)
	}
}

func TestEmptyIDIsRejected(t *testing.T) {
	c := candidate("", 1, "declared-a", true)
	run := fairness.Run{RunID: "synthetic-id", Seed: 1, SelectionCutoff: 1, Candidates: []fairness.Candidate{c}}
	_, err := fairness.Audit(run, fairness.Options{})
	if err == nil || !strings.Contains(err.Error(), "id") {
		t.Fatalf("err=%v", err)
	}
}

func TestNoCandidatesIsRejected(t *testing.T) {
	_, err := fairness.Audit(fairness.Run{RunID: "synthetic-empty", SelectionCutoff: 1}, fairness.Options{})
	if err == nil || !strings.Contains(err.Error(), "no candidates") {
		t.Fatalf("err=%v", err)
	}
}

func TestBadCutoffIsRejected(t *testing.T) {
	run := fairness.Run{
		RunID:           "synthetic-cutoff",
		Seed:            1,
		SelectionCutoff: 0,
		Candidates:      []fairness.Candidate{candidate("a", 1, "declared-a", true)},
	}
	_, err := fairness.Audit(run, fairness.Options{})
	if err == nil || !strings.Contains(err.Error(), "cutoff") {
		t.Fatalf("err=%v", err)
	}
}

func TestChecksAreNamedAndOrdered(t *testing.T) {
	rep := mustAudit(t, interleavedRun(), fairness.Options{MinGroupSize: 10})
	want := []string{
		fairness.CheckParity,
		fairness.CheckExposure,
		fairness.CheckCounterfactual,
		fairness.CheckProxies,
		fairness.CheckExplanations,
	}
	if len(rep.Checks) != len(want) {
		t.Fatalf("checks=%v", rep.Checks)
	}
	for i, name := range want {
		if rep.Checks[i].Name != name {
			t.Fatalf("check[%d]=%s want %s", i, rep.Checks[i].Name, name)
		}
	}
}

func pid(prefix string, i int) string {
	return prefix + "-" + two(i)
}

func two(i int) string {
	if i < 10 {
		return "0" + string(rune('0'+i))
	}
	return string(rune('0'+i/10)) + string(rune('0'+i%10))
}

func slicesHas(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}
