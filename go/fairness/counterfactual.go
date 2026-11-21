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
		swaps := []struct {
			kind, from, to, text string
		}{}
		if text, from, to, ok := swapToken(c.Text, namePairs); ok {
			swaps = append(swaps, struct {
				kind, from, to, text string
			}{"name", from, to, text})
		}
		if text, from, to, ok := swapToken(c.Text, markerPairs); ok {
			swaps = append(swaps, struct {
				kind, from, to, text string
			}{"gender-marker", from, to, text})
		}
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
			delta := math.Abs(swapped - original)
			within := delta <= epsilon
			if !within {
				outside++
			}
			result.Cases = append(result.Cases, CounterfactualCase{
				CandidateID: c.ID,
				Kind:        swap.kind,
				From:        swap.from,
				To:          swap.to,
				Original:    original,
				Swapped:     swapped,
				Delta:       delta,
				Within:      within,
			})
		}
	}
	sort.Strings(result.UncoveredIDs)
	sort.Slice(result.Cases, func(i, j int) bool {
		if result.Cases[i].CandidateID != result.Cases[j].CandidateID {
			return result.Cases[i].CandidateID < result.Cases[j].CandidateID
		}
		return result.Cases[i].Kind < result.Cases[j].Kind
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
	switch canonKey(key) {
	case "protectedgroup", "protected", "grouplabel":
		return true
	default:
		return false
	}
}

func canonKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	key = strings.ReplaceAll(key, "_", "")
	key = strings.ReplaceAll(key, "-", "")
	key = strings.ReplaceAll(key, " ", "")
	return key
}
