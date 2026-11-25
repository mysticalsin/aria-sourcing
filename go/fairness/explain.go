package fairness

import (
	"fmt"
	"sort"
	"strings"
)

func checkExplanations(run Run) ExplanationResult {
	var missing []string
	for _, c := range run.Candidates {
		if !hasReason(c.Reasons) {
			missing = append(missing, c.ID)
		}
	}
	sort.Strings(missing)
	if missing == nil {
		missing = []string{}
	}
	if len(missing) == 0 {
		return ExplanationResult{
			Verdict:    VerdictPass,
			Complete:   true,
			MissingIDs: missing,
			Detail:     "every ranked candidate has a top reason",
		}
	}
	return ExplanationResult{
		Verdict:    VerdictFail,
		Complete:   false,
		MissingIDs: missing,
		Detail:     fmt.Sprintf("missing top reasons for %s", strings.Join(missing, ", ")),
	}
}

func hasReason(reasons []string) bool {
	for _, reason := range reasons {
		if strings.TrimSpace(reason) != "" {
			return true
		}
	}
	return false
}
