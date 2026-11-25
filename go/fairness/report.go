package fairness

import (
	"encoding/json"
	"fmt"
	"strings"
)

// JSON encodes the report in a stable, indented form.
func (r Report) JSON() ([]byte, error) {
	return json.MarshalIndent(r, "", "  ")
}

// Markdown renders the report for a recruiter. It repeats the disclaimer.
func (r Report) Markdown() string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Aria fairness audit\n\n")
	fmt.Fprintf(&b, "**Verdict:** %s\n\n", r.Verdict)
	fmt.Fprintf(&b, "%s\n\n", r.Disclaimer)
	fmt.Fprintf(&b, "Run `%s`. Minimum group size %d. Counterfactual epsilon %g. Discarded labels %d.\n\n", oneLine(r.RunID), r.MinGroupSize, r.Epsilon, r.DiscardedLabels)
	fmt.Fprintf(&b, "There is no auto-reject. Ranking is a suggestion for recruiter prioritisation, and a human decides.\n\n")

	fmt.Fprintf(&b, "## Checks\n\n")
	fmt.Fprintf(&b, "| Check | Verdict | Detail |\n| --- | --- | --- |\n")
	for _, c := range r.Checks {
		fmt.Fprintf(&b, "| %s | %s | %s |\n", c.Name, c.Verdict, oneLine(c.Detail))
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "## Selection rates\n\n")
	fmt.Fprintf(&b, "%s\n\n", SelectionRateFormula)
	fmt.Fprintf(&b, "| Attribute | Group | N | Selected | Rate | Mean rank | Verdict |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n")
	for _, g := range r.Groups {
		fmt.Fprintf(&b, "| %s | %s | %d | %d | %.6f | %.3f | %s |\n", oneLine(g.Attribute), oneLine(g.Group), g.N, g.Selected, g.SelectionRate, g.MeanRank, g.Verdict)
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "## Four-fifths ratio\n\n")
	fmt.Fprintf(&b, "%s\n\n", FourFifthsFormula)
	fmt.Fprintf(&b, "A group below the minimum size has no verdict. The ratio on that row is descriptive only.\n\n")
	fmt.Fprintf(&b, "| Group | Reference | N | Rate | Reference rate | Ratio | Adverse impact | Verdict | Note |\n| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |\n")
	for _, row := range r.FourFifths {
		ratio := "n/a"
		if row.RatioDefined {
			ratio = fmt.Sprintf("%.6f", row.Ratio)
		}
		fmt.Fprintf(&b, "| %s | %s | %d | %.6f | %.6f | %s | %t | %s | %s |\n", oneLine(row.Group), oneLine(row.ReferenceGroup), row.N, row.SelectionRate, row.ReferenceRate, ratio, row.AdverseImpact, row.Verdict, oneLine(row.Warning))
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "## Rank-position exposure\n\n")
	fmt.Fprintf(&b, "%s\n\n", ExposureFormula)
	fmt.Fprintf(&b, "The exposure ratio uses the same 4/5 line as a review threshold. A gap above %.2f warns when the ratio is still at least 4/5.\n\n", ExposureWarnGap)
	fmt.Fprintf(&b, "| Group | Reference | Exposure | Reference exposure | Ratio | Gap | Verdict | Note |\n| --- | --- | ---: | ---: | ---: | ---: | --- | --- |\n")
	for _, row := range r.Exposure {
		fmt.Fprintf(&b, "| %s | %s | %.6f | %.6f | %.6f | %.6f | %s | %s |\n", oneLine(row.Group), oneLine(row.ReferenceGroup), row.Exposure, row.ReferenceExposure, row.Ratio, row.Gap, row.Verdict, oneLine(row.Warning))
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "## Counterfactual\n\n")
	fmt.Fprintf(&b, "Swap a synthetic name token or a gender marker in the text and rescore. The absolute score change must be within epsilon %g. The protected-group label is not an input to the scorer.\n\n", r.Counterfactual.Epsilon)
	fmt.Fprintf(&b, "Ran: %t. Verdict: %s. %s\n\n", r.Counterfactual.Ran, r.Counterfactual.Verdict, r.Counterfactual.Detail)

	fmt.Fprintf(&b, "## Proxy features\n\n")
	if len(r.Proxies) == 0 {
		fmt.Fprintf(&b, "No postcode, graduation year, or photo feature was flagged.\n\n")
	} else {
		fmt.Fprintf(&b, "| Feature | Reason | Candidates |\n| --- | --- | --- |\n")
		for _, f := range r.Proxies {
			ids := make([]string, len(f.CandidateIDs))
			for i, id := range f.CandidateIDs {
				ids[i] = oneLine(id)
			}
			fmt.Fprintf(&b, "| %s | %s | %s |\n", oneLine(f.Feature), oneLine(f.Reason), strings.Join(ids, ", "))
		}
		b.WriteString("\n")
	}

	fmt.Fprintf(&b, "## Explanation completeness\n\n")
	fmt.Fprintf(&b, "Verdict: %s. %s\n\n", r.Explanations.Verdict, oneLine(r.Explanations.Detail))

	if len(r.Warnings) > 0 {
		fmt.Fprintf(&b, "## Warnings\n\n")
		for _, w := range r.Warnings {
			fmt.Fprintf(&b, "- %s\n", oneLine(w))
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "This report does not certify compliance.\n")
	return b.String()
}

func oneLine(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "|", "/")
	return s
}
