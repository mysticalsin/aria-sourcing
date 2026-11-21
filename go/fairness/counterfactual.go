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

type featureProbe struct {
	class string
	from  string
	to    string
	orig  map[string]any
	flip  map[string]any
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
		probes := featureProbes(c)
		if len(swaps) == 0 && len(probes) == 0 {
			result.UncoveredIDs = append(result.UncoveredIDs, c.ID)
			continue
		}
		if len(swaps) > 0 {
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
		for _, probe := range probes {
			original, err := scoreFinite(scorer, ScoreView{ID: c.ID, Text: c.Text, Features: probe.orig})
			if err != nil {
				return CounterfactualResult{}, fmt.Errorf("fairness: score %s: %w", c.ID, err)
			}
			swapped, err := scoreFinite(scorer, ScoreView{ID: c.ID, Text: c.Text, Features: probe.flip})
			if err != nil {
				return CounterfactualResult{}, fmt.Errorf("fairness: score %s: %w", c.ID, err)
			}
			outside += appendCase(&result, c.ID, "protected-attribute", probe.class+"="+probe.from, probe.class+"="+probe.to, original, swapped, epsilon)
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
		result.Detail = "a name, gender-marker, or protected-attribute flip changed the score by more than epsilon"
	case len(result.Cases) == 0:
		result.Verdict = VerdictInsufficient
		result.Detail = "no candidate had a swappable name, gender marker, or protected feature"
	case len(result.UncoveredIDs) > 0:
		result.Verdict = VerdictWarn
		result.Detail = "some candidates had no swappable name, gender marker, or protected feature"
	default:
		result.Verdict = VerdictPass
		result.Detail = "name, gender-marker, and protected-attribute flips stayed within epsilon"
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

func featureProbes(c Candidate) []featureProbe {
	keys := make([]string, 0, len(c.Features))
	for key := range c.Features {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var probes []featureProbe
	for _, key := range keys {
		class := featureClass(key)
		if class == "" || class == "label" {
			continue
		}
		flipped, ok := flipFeature(class, c.Features[key])
		if !ok {
			continue
		}
		probes = append(probes, featureProbe{
			class: class,
			from:  fmt.Sprint(c.Features[key]),
			to:    fmt.Sprint(flipped),
			orig:  probeFeatures(c.Features, key, c.Features[key]),
			flip:  probeFeatures(c.Features, key, flipped),
		})
	}
	return probes
}

func probeFeatures(all map[string]any, keepKey string, keepValue any) map[string]any {
	out := map[string]any{}
	for key, value := range all {
		if featureClass(key) == "" {
			out[key] = value
		}
	}
	out[keepKey] = keepValue
	return out
}

func flipFeature(class string, value any) (any, bool) {
	switch class {
	case "gender", "race", "ethnicity", "religion", "disability":
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil, false
		}
		if text == "group-b" {
			return "group-a", true
		}
		return "group-b", true
	case "age", "graduationYear":
		number, ok := asNumber(value)
		if !ok {
			return nil, false
		}
		return number + 15, true
	case "postcode":
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil, false
		}
		if text == "SYN-001" {
			return "SYN-000", true
		}
		return "SYN-001", true
	case "photo":
		switch v := value.(type) {
		case bool:
			return !v, true
		case string:
			if strings.TrimSpace(v) == "" {
				return "synthetic-photo", true
			}
			return "", true
		default:
			return nil, false
		}
	default:
		return nil, false
	}
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

func protectedFeatureKey(key string) bool {
	class := featureClass(key)
	return class != ""
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
