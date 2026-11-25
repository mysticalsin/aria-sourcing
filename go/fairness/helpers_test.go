package fairness_test

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

type invariantScorer struct{}

func (invariantScorer) Score(v fairness.ScoreView) (float64, error) {
	var score float64
	switch y := v.Features["yearsExperience"].(type) {
	case float64:
		score += y
	case int:
		score += float64(y)
	}
	if s, ok := v.Features["skills"].(string); ok {
		for _, c := range s {
			score += float64(c%7) * 0.001
		}
	}
	return score, nil
}

type biasedScorer struct{}

func (biasedScorer) Score(v fairness.ScoreView) (float64, error) {
	if strings.Contains(v.Text, "[marker:she]") || strings.Contains(v.Text, "[name:ada]") {
		return 0.2, nil
	}
	return 0.9, nil
}

type fnScorer struct {
	fn func(fairness.ScoreView) (float64, error)
}

func (s fnScorer) Score(v fairness.ScoreView) (float64, error) { return s.fn(v) }

type spyScorer struct {
	views []fairness.ScoreView
}

func (s *spyScorer) Score(v fairness.ScoreView) (float64, error) {
	cp := v
	cp.Features = map[string]any{}
	for k, val := range v.Features {
		cp.Features[k] = val
	}
	s.views = append(s.views, cp)
	return 1, nil
}

func candidate(id string, rank int, group string, consented bool) fairness.Candidate {
	name := "[name:ada]"
	marker := "[marker:she]"
	if group == "declared-b" {
		name = "[name:alan]"
		marker = "[marker:he]"
	}
	var label *fairness.ProtectedLabel
	if group != "" {
		label = &fairness.ProtectedLabel{
			Attribute:    "synthetic-group",
			Value:        group,
			Consented:    consented,
			SelfDeclared: true,
		}
	}
	return fairness.Candidate{
		ID:             id,
		Rank:           rank,
		Score:          50,
		Text:           name + " " + marker + " skill:synthetic",
		Features:       map[string]any{"skills": "synthetic", "yearsExperience": 3.0},
		Reasons:        []string{"synthetic skill match"},
		ProtectedGroup: label,
	}
}

func ratioRun(nA, selA, nB, selB int) fairness.Run {
	if selA > nA || selB > nB || selA < 0 || selB < 0 {
		panic("ratioRun: selection exceeds group size")
	}
	var cs []fairness.Candidate
	rank := 1
	add := func(group string, k, idBase int) int {
		for i := 0; i < k; i++ {
			cs = append(cs, candidate(fmt.Sprintf("%s-%02d", group, idBase+i), rank, group, true))
			rank++
		}
		return idBase + k
	}
	add("declared-a", selA, 0)
	add("declared-b", selB, 0)
	add("declared-a", nA-selA, selA)
	add("declared-b", nB-selB, selB)
	return fairness.Run{
		RunID:           "synthetic-ratio",
		Seed:            1,
		SelectionCutoff: selA + selB,
		Candidates:      cs,
	}
}

func interleavedRun() fairness.Run {
	var cs []fairness.Candidate
	for i := 0; i < 20; i++ {
		cs = append(cs, candidate(fmt.Sprintf("a-%02d", i), 2*i+1, "declared-a", true))
		cs = append(cs, candidate(fmt.Sprintf("b-%02d", i), 2*i+2, "declared-b", true))
	}
	return fairness.Run{
		RunID:           "synthetic-interleave",
		Seed:            7,
		SelectionCutoff: 40,
		Candidates:      cs,
	}
}

func separatedRun() fairness.Run {
	var cs []fairness.Candidate
	for i := 0; i < 20; i++ {
		cs = append(cs, candidate(fmt.Sprintf("a-%02d", i), i+1, "declared-a", true))
		cs = append(cs, candidate(fmt.Sprintf("b-%02d", i), 500+i, "declared-b", true))
	}
	return fairness.Run{
		RunID:           "synthetic-separated",
		Seed:            3,
		SelectionCutoff: 20,
		Candidates:      cs,
	}
}

func mustAudit(t *testing.T, run fairness.Run, opt fairness.Options) fairness.Report {
	t.Helper()
	rep, err := fairness.Audit(run, opt)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if rep.AutoReject {
		t.Fatal("auto-reject must stay off")
	}
	if !rep.HumanDecisionRequired {
		t.Fatal("a human decision is required")
	}
	if rep.Disclaimer != fairness.Disclaimer {
		t.Fatalf("disclaimer = %q", rep.Disclaimer)
	}
	switch rep.Verdict {
	case fairness.VerdictInsufficient, fairness.VerdictPass, fairness.VerdictWarn, fairness.VerdictFail:
	default:
		t.Fatalf("verdict %q is not one of Insufficient, Pass, Warn, Fail", rep.Verdict)
	}
	raw, err := rep.JSON()
	if err != nil {
		t.Fatalf("json: %v", err)
	}
	if !json.Valid(raw) {
		t.Fatal("report JSON is invalid")
	}
	md := rep.Markdown()
	for _, needle := range []string{"no auto-reject", "does not certify", "4/5", "log2", string(rep.Verdict)} {
		if !strings.Contains(md, needle) {
			t.Fatalf("markdown missing %q\n%s", needle, md)
		}
	}
	return rep
}

func fourFifths(t *testing.T, rep fairness.Report, group string) fairness.FourFifthsRow {
	t.Helper()
	for _, row := range rep.FourFifths {
		if row.Group == group {
			return row
		}
	}
	t.Fatalf("no four-fifths row for %s", group)
	return fairness.FourFifthsRow{}
}

func exposureRow(t *testing.T, rep fairness.Report, group string) fairness.ExposureRow {
	t.Helper()
	for _, row := range rep.Exposure {
		if row.Group == group {
			return row
		}
	}
	t.Fatalf("no exposure row for %s", group)
	return fairness.ExposureRow{}
}

func checkNamed(t *testing.T, rep fairness.Report, name string) fairness.Check {
	t.Helper()
	for _, c := range rep.Checks {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no check %s", name)
	return fairness.Check{}
}

func finiteUnit(t *testing.T, name string, v float64, lo, hi float64) {
	t.Helper()
	if math.IsNaN(v) || math.IsInf(v, 0) || v < lo || v > hi {
		t.Fatalf("%s=%v want [%v, %v]", name, v, lo, hi)
	}
}
