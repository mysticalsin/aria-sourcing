package fairness_test

import (
	"bytes"
	"encoding/json"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

func TestPropertyBoundedRatios(t *testing.T) {
	spec := fairness.GenSpec{N: 36, Cutoff: 12, ProxyEvery: 4}
	opt := fairness.Options{MinGroupSize: 1, Epsilon: 1e-9, Scorer: invariantScorer{}}
	for seed := int64(1); seed <= 30; seed++ {
		run, err := fairness.Generate(seed, spec)
		if err != nil {
			t.Fatalf("seed %d generate: %v", seed, err)
		}
		rep := mustAudit(t, run, opt)
		if rep.AutoReject || !rep.HumanDecisionRequired {
			t.Fatalf("seed %d human-decision flags", seed)
		}
		for _, g := range rep.Groups {
			finiteUnit(t, "selectionRate", g.SelectionRate, 0, 1)
			if g.Exposure <= 0 || g.Exposure > 1 {
				t.Fatalf("seed %d exposure %v", seed, g.Exposure)
			}
			finiteUnit(t, "exposure", g.Exposure, 0, 1)
			if g.MeanRank < 1 {
				t.Fatalf("seed %d mean rank %v", seed, g.MeanRank)
			}
			if g.N < 1 || g.Selected < 0 || g.Selected > g.N {
				t.Fatalf("seed %d counts %+v", seed, g)
			}
		}
		for _, row := range rep.FourFifths {
			if !row.RatioDefined {
				continue
			}
			finiteUnit(t, "four-fifths", row.Ratio, 0, 1+1e-9)
			if row.AdverseImpact && row.Verdict != fairness.VerdictFail && row.Verdict != fairness.VerdictInsufficient {
				t.Fatalf("seed %d adverse impact without fail: %+v", seed, row)
			}
			if row.N < opt.MinGroupSize && row.Verdict != fairness.VerdictInsufficient {
				t.Fatalf("seed %d small group verdict %+v", seed, row)
			}
		}
		for _, row := range rep.Exposure {
			finiteUnit(t, "exposureRatio", row.Ratio, 0, 1+1e-9)
			finiteUnit(t, "exposureGap", row.Gap, 0, 1)
		}
	}
}

func TestPropertyDeterminism(t *testing.T) {
	spec := fairness.GenSpec{N: 24, Cutoff: 8, ProxyEvery: 3, MinGroupSize: 4}
	opt := fairness.Options{MinGroupSize: 4, Epsilon: 1e-6, Scorer: invariantScorer{}}
	for _, seed := range []int64{0, 1, 42} {
		first, err := fairness.Generate(seed, spec)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		second, err := fairness.Generate(seed, spec)
		if err != nil {
			t.Fatalf("seed %d second: %v", seed, err)
		}
		if !bytes.Equal(mustJSON(t, first), mustJSON(t, second)) {
			t.Fatalf("seed %d generate is not deterministic", seed)
		}
		a := mustAudit(t, first, opt)
		b := mustAudit(t, second, opt)
		aj, err := a.JSON()
		if err != nil {
			t.Fatal(err)
		}
		bj, err := b.JSON()
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(aj, bj) {
			t.Fatalf("seed %d audit is not deterministic", seed)
		}
		if a.Markdown() != b.Markdown() {
			t.Fatalf("seed %d markdown is not deterministic", seed)
		}
	}
}

func TestPropertyDistinctSeedsDiffer(t *testing.T) {
	spec := fairness.GenSpec{N: 16, Cutoff: 4}
	a, err := fairness.Generate(1, spec)
	if err != nil {
		t.Fatal(err)
	}
	b, err := fairness.Generate(2, spec)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(mustJSON(t, a), mustJSON(t, b)) {
		t.Fatal("different seeds produced the same run")
	}
}

func TestPropertyPermutationInvariance(t *testing.T) {
	spec := fairness.GenSpec{N: 20, Cutoff: 6, ProxyEvery: 5}
	opt := fairness.Options{MinGroupSize: 1, Epsilon: 1e-9, Scorer: invariantScorer{}}
	for seed := int64(1); seed <= 8; seed++ {
		run, err := fairness.Generate(seed, spec)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		base := mustAudit(t, run, opt)
		baseJSON, err := base.JSON()
		if err != nil {
			t.Fatal(err)
		}

		reversed := run
		reversed.Candidates = slices.Clone(run.Candidates)
		slices.Reverse(reversed.Candidates)
		if sameOrder(run.Candidates, reversed.Candidates) {
			t.Fatal("reverse did not change order")
		}
		rev := mustAudit(t, reversed, opt)
		revJSON, err := rev.JSON()
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(baseJSON, revJSON) {
			t.Fatalf("seed %d reverse changed the report", seed)
		}

		shuffled := run
		shuffled.Candidates = slices.Clone(run.Candidates)
		rng := rand.New(rand.NewPCG(uint64(seed), 99))
		rng.Shuffle(len(shuffled.Candidates), func(i, j int) {
			shuffled.Candidates[i], shuffled.Candidates[j] = shuffled.Candidates[j], shuffled.Candidates[i]
		})
		sh := mustAudit(t, shuffled, opt)
		shJSON, err := sh.JSON()
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(baseJSON, shJSON) {
			t.Fatalf("seed %d shuffle changed the report", seed)
		}
		if rev.Verdict != base.Verdict || sh.Verdict != base.Verdict {
			t.Fatalf("seed %d verdict changed under permutation", seed)
		}
	}
}

func TestPropertyGeneratedCounterfactualIsInvariantToText(t *testing.T) {
	spec := fairness.GenSpec{N: 12, Cutoff: 4, ProxyEvery: 0}
	opt := fairness.Options{MinGroupSize: 1, Epsilon: 1e-9, Scorer: invariantScorer{}}
	run, err := fairness.Generate(11, spec)
	if err != nil {
		t.Fatal(err)
	}
	rep := mustAudit(t, run, opt)
	cf := checkNamed(t, rep, fairness.CheckCounterfactual)
	if cf.Verdict != fairness.VerdictPass || !rep.Counterfactual.Ran {
		t.Fatalf("counterfactual %+v check %+v", rep.Counterfactual, cf)
	}
	if len(rep.Counterfactual.Cases) == 0 || len(rep.Counterfactual.UncoveredIDs) != 0 {
		t.Fatalf("cases=%d uncovered=%v", len(rep.Counterfactual.Cases), rep.Counterfactual.UncoveredIDs)
	}
	for _, c := range rep.Counterfactual.Cases {
		if !c.Within || c.Delta > opt.Epsilon {
			t.Fatalf("case %+v", c)
		}
		if c.Kind != "name" && c.Kind != "gender-marker" {
			t.Fatalf("kind %s", c.Kind)
		}
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func sameOrder(a, b []fairness.Candidate) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].ID != b[i].ID {
			return false
		}
	}
	return true
}
