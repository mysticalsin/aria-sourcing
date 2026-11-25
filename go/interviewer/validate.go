package interviewer

import (
	"fmt"
	"regexp"
	"strings"
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
		trimmed := strings.TrimSpace(q)
		if trimmed == "" || len(trimmed) > maxSummaryLen {
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

// languagePattern is a practical BCP 47 tag: a letter primary subtag, then
// hyphen-separated alphanumeric subtags. Digit-only values are phone numbers,
// not languages, and the language field is not redacted before it is sent.
var languagePattern = regexp.MustCompile(`^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$`)

func validLanguage(raw string) bool {
	if len(raw) < 2 || len(raw) > maxLanguageLen {
		return false
	}
	return languagePattern.MatchString(raw)
}

func trimmedQuestions(in []string) []string {
	out := make([]string, len(in))
	for i, q := range in {
		out[i] = strings.TrimSpace(q)
	}
	return out
}
