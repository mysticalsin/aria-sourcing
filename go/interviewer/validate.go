package interviewer

import (
	"fmt"
	"strings"
	"unicode"
)

const (
	maxSummaryLen  = 8000
	maxQuestions   = 20
	maxLanguageLen = 35
	maxIDLen       = 128
)

func validateEligibility(c Candidate, n Need) error {
	if c.Stage != StageToInterview {
		return fmt.Errorf("%w: stage %q", ErrValidation, c.Stage)
	}
	if !c.HumanApprovalRecorded {
		return fmt.Errorf("%w: human approval", ErrValidation)
	}
	if err := validateID("approval", c.ApprovalID); err != nil {
		return err
	}
	if !c.Consent {
		return fmt.Errorf("%w: consent", ErrValidation)
	}
	if err := validateID("candidate", c.ID); err != nil {
		return err
	}
	if err := validateID("need", n.ID); err != nil {
		return err
	}
	if !validLanguage(c.Language) {
		return fmt.Errorf("%w: language", ErrValidation)
	}
	summary := strings.TrimSpace(n.Summary)
	if summary == "" || len(summary) > maxSummaryLen {
		return fmt.Errorf("%w: need summary", ErrValidation)
	}
	if len(n.RoleQuestions) < 1 || len(n.RoleQuestions) > maxQuestions {
		return fmt.Errorf("%w: role questions", ErrValidation)
	}
	for _, q := range n.RoleQuestions {
		if strings.TrimSpace(q) == "" {
			return fmt.Errorf("%w: role question", ErrValidation)
		}
	}
	return nil
}

func validateID(kind, raw string) error {
	id := strings.TrimSpace(raw)
	if id == "" || len(id) > maxIDLen || id != raw {
		return fmt.Errorf("%w: %s id", ErrValidation, kind)
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == ':' || r == '-' {
			continue
		}
		return fmt.Errorf("%w: %s id", ErrValidation, kind)
	}
	return nil
}

func validLanguage(raw string) bool {
	if len(raw) < 2 || len(raw) > maxLanguageLen {
		return false
	}
	for i, r := range raw {
		if r == '-' {
			if i == 0 || i == len(raw)-1 {
				return false
			}
			continue
		}
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func trimmedQuestions(in []string) []string {
	out := make([]string, len(in))
	for i, q := range in {
		out[i] = strings.TrimSpace(q)
	}
	return out
}
