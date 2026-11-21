package fairness_test

import (
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

// Bias is detected from a name or marker token swap. The gender field itself
// must not be visible to the scorer on any call.
func TestGenderSpyFailsTheAudit(t *testing.T) {
	person := candidate("only", 1, "declared-a", true)
	person.Features["gender"] = "group-a"
	scorer := fnScorer{fn: func(v fairness.ScoreView) (float64, error) {
		if _, ok := v.Features["gender"]; ok {
			t.Fatalf("scorer received gender on %q", v.Text)
		}
		if strings.Contains(v.Text, "[marker:she]") {
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
		t.Fatalf("marker swap must fail the audit: counterfactual=%s overall=%s detail=%s", rep.Counterfactual.Verdict, rep.Verdict, rep.Counterfactual.Detail)
	}
	if rep.AutoReject {
		t.Fatal("a failed counterfactual still must not auto-reject")
	}
	saw := false
	for _, item := range rep.Counterfactual.Cases {
		if item.Kind == "protected-attribute" {
			t.Fatalf("probe passed a raw protected field: %+v", item)
		}
		if (item.Kind == "name" || item.Kind == "gender-marker") && !item.Within && item.Delta > 1e-6 {
			saw = true
		}
	}
	if !saw {
		t.Fatalf("expected a name or marker swap outside tolerance, cases=%+v", rep.Counterfactual.Cases)
	}
}

func TestFeatureOnlyCandidateDoesNotPassRawFields(t *testing.T) {
	person := candidate("only", 1, "declared-a", true)
	person.Text = "skill:synthetic"
	person.Features = map[string]any{
		"skills":          "synthetic",
		"ethnicity":       "group-a",
		"postcode":        "SYN-000",
		"photoPresent":    true,
		"yearsExperience": 4.0,
	}
	spy := &spyScorer{}
	run := fairness.Run{
		RunID:           "synthetic-feature-only",
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{person},
	}
	rep := mustAudit(t, run, fairness.Options{MinGroupSize: 1, Epsilon: 1e-6, Scorer: spy})
	for _, item := range rep.Counterfactual.Cases {
		if item.Kind == "protected-attribute" {
			t.Fatalf("feature-only input produced a raw-field probe: %+v", item)
		}
	}
	for _, view := range spy.views {
		for _, key := range []string{"ethnicity", "postcode", "photoPresent", "photo", "gender"} {
			if _, ok := view.Features[key]; ok {
				t.Fatalf("scorer received %s", key)
			}
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
