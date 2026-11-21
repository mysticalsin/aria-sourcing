package fairness_test

import (
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

type errString string

func (e errString) Error() string { return string(e) }

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
			if err := strippingViolation(key); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestDenylistMutantFailsStrippingTests swaps the denylist for a key that
// never matches. The same stripping check the suite uses must then fail.
func TestDenylistMutantFailsStrippingTests(t *testing.T) {
	if err := strippingViolation("gender"); err != nil {
		t.Fatalf("production denylist should strip gender on every score call: %v", err)
	}
	restore := fairness.SetDenylistForTest([]string{"never-matches"})
	defer restore()
	if err := strippingViolation("gender"); err == nil {
		t.Fatal("a denylist that never matches must fail the gender stripping check")
	}
	if err := strippingViolation("postcode"); err == nil {
		t.Fatal("a denylist that never matches must fail the postcode stripping check")
	}
	if err := strippingViolation("graduationYear"); err == nil {
		t.Fatal("a denylist that never matches must fail the graduationYear stripping check")
	}
	if err := strippingViolation("photoPresent"); err == nil {
		t.Fatal("a denylist that never matches must fail the photo stripping check")
	}
}

func strippingViolation(key string) error {
	person := candidate("only", 1, "declared-a", true)
	person.Features = map[string]any{
		"skills":          "synthetic",
		"yearsExperience": 4.0,
		key:               stripFixtureValue(key),
	}
	spy := &spyScorer{}
	_, err := fairness.Audit(fairness.Run{
		RunID:           "synthetic-strip-" + key,
		Seed:            1,
		SelectionCutoff: 1,
		Candidates:      []fairness.Candidate{person},
	}, fairness.Options{MinGroupSize: 1, Epsilon: 1e-6, Scorer: spy})
	if err != nil {
		return err
	}
	return viewsLeakKey(spy, key)
}

func viewsLeakKey(spy *spyScorer, key string) error {
	if len(spy.views) == 0 {
		return errString("scorer was not called")
	}
	for _, view := range spy.views {
		if viewHasKey(view, key) {
			return errString("scorer saw " + key + " on " + view.Text)
		}
	}
	return nil
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
