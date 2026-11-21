package fairness

import (
	"fmt"
	"math/rand/v2"
	"sort"
)

// Generate builds a synthetic ranking from seed. The same seed and spec always
// return the same run. Names, markers, and postcodes are synthetic tokens.
func Generate(seed int64, spec GenSpec) (Run, error) {
	if spec.N == 0 {
		spec.N = 40
	}
	if spec.N < 1 {
		return Run{}, fmt.Errorf("fairness: n must be positive")
	}
	if spec.Cutoff == 0 {
		spec.Cutoff = spec.N / 2
		if spec.Cutoff < 1 {
			spec.Cutoff = 1
		}
	}
	if spec.Cutoff < 1 {
		return Run{}, fmt.Errorf("fairness: selection cutoff must be positive")
	}
	if spec.ProxyEvery < 0 {
		return Run{}, fmt.Errorf("fairness: proxy interval must be non-negative")
	}
	if spec.Attribute == "" {
		spec.Attribute = "synthetic-group"
	}
	if len(spec.Groups) == 0 {
		spec.Groups = []string{"declared-a", "declared-b"}
	}

	rng := rand.New(rand.NewPCG(uint64(seed), 0xF41A5EED))
	type draft struct {
		id       string
		group    string
		score    float64
		text     string
		features map[string]any
	}
	drafts := make([]draft, spec.N)
	for i := 0; i < spec.N; i++ {
		name := "[name:ada]"
		marker := "[marker:she]"
		if i%2 == 1 {
			name = "[name:alan]"
			marker = "[marker:he]"
		}
		features := map[string]any{
			"skills":          "synthetic",
			"yearsExperience": float64(1 + i%10),
		}
		if spec.ProxyEvery > 0 && i%spec.ProxyEvery == 0 {
			features["postcode"] = "SYN-000"
			features["graduationYear"] = float64(2000 + (i % 20))
			features["photoPresent"] = true
		}
		drafts[i] = draft{
			id:       fmt.Sprintf("c-%03d", i+1),
			group:    spec.Groups[i%len(spec.Groups)],
			score:    rng.Float64() * 100,
			text:     name + " " + marker + " skill:synthetic",
			features: features,
		}
	}
	sort.Slice(drafts, func(i, j int) bool {
		if drafts[i].score != drafts[j].score {
			return drafts[i].score > drafts[j].score
		}
		return drafts[i].id < drafts[j].id
	})

	candidates := make([]Candidate, spec.N)
	for i, d := range drafts {
		candidates[i] = Candidate{
			ID:       d.id,
			Rank:     i + 1,
			Score:    d.score,
			Text:     d.text,
			Features: d.features,
			Reasons:  []string{"synthetic skill match", "synthetic experience"},
			ProtectedGroup: &ProtectedLabel{
				Attribute:    spec.Attribute,
				Value:        d.group,
				Consented:    true,
				SelfDeclared: true,
			},
		}
	}
	minN := spec.MinGroupSize
	return Run{
		RunID:           fmt.Sprintf("synthetic-%d", seed),
		Seed:            seed,
		SelectionCutoff: spec.Cutoff,
		MinGroupSize:    minN,
		Candidates:      candidates,
	}, nil
}
