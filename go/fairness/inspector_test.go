package fairness_test

import (
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

// A scorer that returns 1 or 90 from a gender feature must fail the audit.
// Candidates with no name or marker token still have to be scored from features.
func TestGenderSpyFailsTheAudit(t *testing.T) {
	person := candidate("only", 1, "declared-a", true)
	person.Text = "skill:synthetic"
	person.Features = map[string]any{
		"skills": "synthetic",
		"gender": "group-a",
	}
	scorer := fnScorer{fn: func(v fairness.ScoreView) (float64, error) {
		if g, _ := v.Features["gender"].(string); g == "group-a" {
			return 1, nil
		}
		return 90, nil
	}}
	run := fairness.Run{
		RunID:           "synthetic-gender-spy",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{person},
	}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1, Epsilon: 1e-6, Scorer: scorer})
	if rep.Counterfactual.Verdict != fairness.VerdictFail || rep.Verdict != fairness.VerdictFail {
		t.Fatalf("gender spy must fail the audit: counterfactual=%s overall=%s detail=%s", rep.Counterfactual.Verdict, rep.Verdict, rep.Counterfactual.Detail)
	}
	if rep.AutoReject {
		t.Fatal("a failed counterfactual still must not auto-reject")
	}
	saw := false
	for _, item := range rep.Counterfactual.Cases {
		if item.Kind == "protected-attribute" && !item.Within && item.Delta > 1e-6 {
			saw = true
		}
	}
	if !saw {
		t.Fatalf("expected a protected-attribute flip outside tolerance, cases=%+v", rep.Counterfactual.Cases)
	}
}

func TestFeatureOnlyCandidateIsScored(t *testing.T) {
	person := candidate("only", 1, "declared-a", true)
	person.Text = "skill:synthetic"
	person.Features = map[string]any{
		"skills":          "synthetic",
		"ethnicity":       "group-a",
		"postcode":        "SYN-000",
		"photoPresent":    true,
		"yearsExperience": 4.0,
	}
	run := fairness.Run{
		RunID:           "synthetic-feature-only",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{person},
	}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1, Epsilon: 1e-6, Scorer: invariantScorer{}})
	if rep.Counterfactual.Verdict == fairness.VerdictInsufficient {
		t.Fatalf("feature-only candidate was not scored: %s", rep.Counterfactual.Detail)
	}
	if len(rep.Counterfactual.Cases) == 0 {
		t.Fatal("expected structured-feature counterfactuals")
	}
	for _, item := range rep.Counterfactual.Cases {
		if item.Kind == "protected-attribute" && !item.Within {
			t.Fatalf("invariant scorer changed on %+v", item)
		}
	}
}

func TestTextSwapsDoNotForwardProtectedFeatures(t *testing.T) {
	person := candidate("only", 1, "declared-a", true)
	person.Features["gender"] = "group-a"
	person.Features["ethnicity"] = "group-a"
	person.Features["postcode"] = "SYN-000"
	person.Features["photoPresent"] = true
	spy := &spyScorer{}
	run := fairness.Run{
		RunID:           "synthetic-strip",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{person},
	}
	mustAudit(t, run, fairness.Options{MinGroupSize: 1, Scorer: spy})
	if len(spy.views) == 0 {
		t.Fatal("scorer was not called")
	}
	checked := 0
	for _, view := range spy.views {
		swapped := strings.Contains(view.Text, "[marker:he]") || strings.Contains(view.Text, "[name:alan]")
		if !swapped {
			continue
		}
		checked++
		for _, key := range []string{"gender", "ethnicity", "race", "postcode", "postalCode", "zip", "photo", "photoPresent"} {
			if _, ok := view.Features[key]; ok {
				t.Fatalf("text swap forwarded %s", key)
			}
		}
	}
	if checked == 0 {
		t.Fatal("no text-swap view was scored")
	}
}
