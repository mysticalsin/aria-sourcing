package fairness

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

var namePairs = [][2]string{
	{"[name:ada]", "[name:alan]"},
	{"[name:noor]", "[name:nabil]"},
}

var markerPairs = [][2]string{
	{"[marker:she]", "[marker:he]"},
	{"[marker:her]", "[marker:his]"},
	{"[marker:woman]", "[marker:man]"},
}

type textSwap struct {
	kind, from, to, text string
}

func runCounterfactual(run Run, scorer Scorer, epsilon float64) (CounterfactualResult, error) {
	result := CounterfactualResult{
		Ran:          false,
		Verdict:      VerdictInsufficient,
		Epsilon:      epsilon,
		Cases:        []CounterfactualCase{},
		UncoveredIDs: []string{},
		Detail:       "no scorer configured; counterfactual not run",
	}
	if scorer == nil {
		return result, nil
	}
	result.Ran = true

	candidates := append([]Candidate(nil), run.Candidates...)
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].ID < candidates[j].ID })

	var outside int
	for _, c := range candidates {
		swaps := textSwaps(c.Text)
		if len(swaps) == 0 {
			result.UncoveredIDs = append(result.UncoveredIDs, c.ID)
			continue
		}
		original, err := scoreFinite(scorer, scoreView(c, c.Text))
		if err != nil {
			return CounterfactualResult{}, fmt.Errorf("fairness: score %s: %w", c.ID, err)
		}
		for _, swap := range swaps {
			swapped, err := scoreFinite(scorer, scoreView(c, swap.text))
			if err != nil {
				return CounterfactualResult{}, fmt.Errorf("fairness: score %s: %w", c.ID, err)
			}
			outside += appendCase(&result, c.ID, swap.kind, swap.from, swap.to, original, swapped, epsilon)
		}
	}
	sort.Strings(result.UncoveredIDs)
	sort.Slice(result.Cases, func(i, j int) bool {
		if result.Cases[i].CandidateID != result.Cases[j].CandidateID {
			return result.Cases[i].CandidateID < result.Cases[j].CandidateID
		}
		if result.Cases[i].Kind != result.Cases[j].Kind {
			return result.Cases[i].Kind < result.Cases[j].Kind
		}
		if result.Cases[i].From != result.Cases[j].From {
			return result.Cases[i].From < result.Cases[j].From
		}
		return result.Cases[i].To < result.Cases[j].To
	})

	switch {
	case outside > 0:
		result.Verdict = VerdictFail
		result.Detail = "a name or gender-marker swap changed the score by more than epsilon"
	case len(result.Cases) == 0:
		result.Verdict = VerdictInsufficient
		result.Detail = "no candidate text had a swappable name or gender marker"
	case len(result.UncoveredIDs) > 0:
		result.Verdict = VerdictWarn
		result.Detail = "some candidates had no swappable name or gender marker"
	default:
		result.Verdict = VerdictPass
		result.Detail = "name and gender-marker swaps stayed within epsilon"
	}
	return result, nil
}

func appendCase(result *CounterfactualResult, id, kind, from, to string, original, swapped, epsilon float64) int {
	delta := math.Abs(swapped - original)
	within := delta <= epsilon
	result.Cases = append(result.Cases, CounterfactualCase{
		CandidateID: id,
		Kind:        kind,
		From:        from,
		To:          to,
		Original:    original,
		Swapped:     swapped,
		Delta:       delta,
		Within:      within,
	})
	if within {
		return 0
	}
	return 1
}

func textSwaps(text string) []textSwap {
	var swaps []textSwap
	if next, from, to, ok := swapToken(text, namePairs); ok {
		swaps = append(swaps, textSwap{"name", from, to, next})
	}
	if next, from, to, ok := swapToken(text, markerPairs); ok {
		swaps = append(swaps, textSwap{"gender-marker", from, to, next})
	}
	return swaps
}

func swapToken(text string, pairs [][2]string) (swapped, from, to string, ok bool) {
	for _, pair := range pairs {
		hasA := strings.Contains(text, pair[0])
		hasB := strings.Contains(text, pair[1])
		switch {
		case hasA && hasB:
			continue
		case hasA:
			return strings.ReplaceAll(text, pair[0], pair[1]), pair[0], pair[1], true
		case hasB:
			return strings.ReplaceAll(text, pair[1], pair[0]), pair[1], pair[0], true
		}
	}
	return "", "", "", false
}

func scoreFinite(scorer Scorer, view ScoreView) (float64, error) {
	score, err := scorer.Score(view)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(score) || math.IsInf(score, 0) {
		return 0, fmt.Errorf("non-finite score")
	}
	return score, nil
}

func scoreView(c Candidate, text string) ScoreView {
	features := make(map[string]any, len(c.Features))
	for key, value := range c.Features {
		if protectedFeatureKey(key) {
			continue
		}
		features[key] = value
	}
	return ScoreView{ID: c.ID, Text: text, Features: features}
}

var stripDenylist = defaultStripDenylist()

func defaultStripDenylist() map[string]struct{} {
	classes := []string{
		"gender", "race", "age", "ethnicity", "religion", "disability",
		"postcode", "graduationYear", "photo", "label",
	}
	set := make(map[string]struct{}, len(classes))
	for _, class := range classes {
		set[class] = struct{}{}
	}
	return set
}

// SetDenylistForTest replaces the strip set for the duration of a test.
// Passing a key that matches no feature class disables stripping.
func SetDenylistForTest(classes []string) func() {
	previous := stripDenylist
	next := make(map[string]struct{}, len(classes))
	for _, class := range classes {
		next[class] = struct{}{}
	}
	stripDenylist = next
	return func() { stripDenylist = previous }
}

func protectedFeatureKey(key string) bool {
	class := featureClass(key)
	if class == "" {
		return false
	}
	_, strip := stripDenylist[class]
	return strip
}

// featureClass is the denylist. Job skills, years of experience, and location
// stay because they are the role criteria; their disparate impact is audited
// on the live ranker rather than removed. Every other name here is stripped
// before a scrubbed score, including letter case and punctuation aliases.
func featureClass(key string) string {
	switch canonKey(key) {
	case "gender", "sex", "genderidentity", "genderid":
		return "gender"
	case "race", "racialgroup":
		return "race"
	case "age", "ageyears", "dateofbirth", "dob", "birthyear", "yearofbirth":
		return "age"
	case "ethnicity", "ethnicgroup":
		return "ethnicity"
	case "religion", "religiousbelief", "faith":
		return "religion"
	case "disability", "disabled", "handicap":
		return "disability"
	case "postcode", "postalcode", "zip", "zipcode":
		return "postcode"
	case "graduationyear", "gradyear":
		return "graduationYear"
	case "photo", "photopresent", "hasphoto", "avatar", "avatarurl":
		return "photo"
	case "protectedgroup", "protected", "grouplabel":
		return "label"
	default:
		return ""
	}
}

func canonKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	key = strings.ReplaceAll(key, "_", "")
	key = strings.ReplaceAll(key, "-", "")
	key = strings.ReplaceAll(key, " ", "")
	return key
}
