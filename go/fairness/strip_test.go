package fairness_test

import (
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

// Each protected attribute and proxy has to be absent from the scrubbed score
// view. A denylist that matches nothing still forwards the key, and this test
// fails in that case. Aliases and letter case are part of the contract.
func TestRecordingScorerNeverSeesEachStrippedFeature(t *testing.T) {
	keys := []string{
		"gender", "Gender", "sex", "SEX",
		"race", "Race",
		"age", "Age", "date_of_birth",
		"ethnicity", "Ethnicity",
		"religion", "Religious_Belief",
		"disability", "Disability",
		"postcode", "Postal_Code", "zip",
		"graduationYear", "Graduation-Year",
		"photo", "PhotoPresent", "photoPresent",
	}
	for _, key := range keys {
		t.Run(key, func(t *testing.T) {
			person := candidate("only", 1, "declared-a", true)
			person.Features = map[string]any{
				"skills":          "synthetic",
				"yearsExperience": 4.0,
				key:               stripFixtureValue(key),
			}
			spy := &spyScorer{}
			run := fairness.Run{
				RunID:           "synthetic-strip-" + key,
				Seed:            1,
				SelectionCutoff: 1,
				Candidates:      []fairness.Candidate{person},
			}
			mustAudit(t, run, fairness.Options{MinGroupSize: 1, Epsilon: 1e-6, Scorer: spy})
			if len(spy.views) == 0 {
				t.Fatal("scorer was not called")
			}
			scrubbed := 0
			forwardedOnSwap := 0
			for _, view := range spy.views {
				if viewHasKey(view, key) && (strings.Contains(view.Text, "[marker:he]") || strings.Contains(view.Text, "[name:alan]")) {
					forwardedOnSwap++
				}
				if !viewHasKey(view, key) && strings.Contains(view.Text, "skill:synthetic") {
					scrubbed++
				}
			}
			if forwardedOnSwap > 0 {
				t.Fatalf("scorer saw %s on a text swap", key)
			}
			if scrubbed == 0 {
				t.Fatalf("no scrubbed view for %s; a denylist that never matches still forwards it", key)
			}
		})
	}
}

func stripFixtureValue(key string) any {
	switch strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", "")) {
	case "photopresent", "photo":
		return true
	case "graduationyear":
		return 2014
	case "age", "dateofbirth":
		return 30
	default:
		return "group-a"
	}
}

func viewHasKey(view fairness.ScoreView, key string) bool {
	if _, ok := view.Features[key]; ok {
		return true
	}
	want := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
	for got := range view.Features {
		canon := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(got, "_", ""), "-", ""))
		if canon == want {
			return true
		}
	}
	return false
}
