package odoo

import (
	"fmt"
	"strings"

	"github.com/mysticalsin/aria-sourcing/services/internal/ident"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/synthetic"
)

func verr(reason string) error {
	return fmt.Errorf("%w: %s", ErrValidation, reason)
}

func cleanName(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 200 {
		return "", verr("name is required")
	}
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return "", verr("name is invalid")
		}
	}
	return s, nil
}

func optionalEmail(s string) (string, error) {
	if strings.TrimSpace(s) == "" {
		return "", nil
	}
	email, err := synthetic.Normalize(s)
	if err != nil {
		return "", verr("email is not a synthetic example.test address")
	}
	return email, nil
}

func requiredEmail(s string) (string, error) {
	email, err := optionalEmail(s)
	if err != nil {
		return "", err
	}
	if email == "" {
		return "", verr("email is not a synthetic example.test address")
	}
	return email, nil
}

func optionalSmart(s, reason string) (string, error) {
	if s == "" {
		return "", nil
	}
	if err := ident.Safe(s, 64); err != nil {
		return "", verr(reason)
	}
	return s, nil
}

func profileOK(s string) error {
	if s == "" {
		return nil
	}
	if len(s) > 300 || strings.ContainsAny(s, " \r\n\t") {
		return verr("profile reference is invalid")
	}
	low := strings.ToLower(s)
	if strings.Contains(low, "li_at") || strings.Contains(low, "voyager") {
		return verr("profile reference is not allowed")
	}
	return nil
}

func validatePartner(in Partner) error {
	if err := ident.Safe(in.AriaID, 64); err != nil {
		return verr("aria id is invalid")
	}
	if err := ident.Safe(in.IdempotencyKey, 200); err != nil {
		return verr("idempotency key is invalid")
	}
	if _, err := cleanName(in.Name); err != nil {
		return err
	}
	if _, err := optionalEmail(in.Email); err != nil {
		return err
	}
	return nil
}

func validateLead(in Lead) error {
	if err := ident.Safe(in.AriaID, 64); err != nil {
		return verr("aria id is invalid")
	}
	if err := ident.Safe(in.IdempotencyKey, 200); err != nil {
		return verr("idempotency key is invalid")
	}
	if _, err := cleanName(in.Name); err != nil {
		return err
	}
	if in.Type != "" && in.Type != "opportunity" {
		return verr("lead type must be opportunity")
	}
	if in.PartnerAriaID != "" {
		if err := ident.Safe(in.PartnerAriaID, 64); err != nil {
			return verr("partner id is invalid")
		}
	}
	return nil
}

func validateJob(in Job) error {
	if err := ident.Safe(in.AriaID, 64); err != nil {
		return verr("aria id is invalid")
	}
	if err := ident.Safe(in.IdempotencyKey, 200); err != nil {
		return verr("idempotency key is invalid")
	}
	if _, err := cleanName(in.Name); err != nil {
		return err
	}
	if len(in.Description) > 4000 {
		return verr("description is too long")
	}
	if in.Openings < 0 {
		return verr("openings must be zero or more")
	}
	if _, err := optionalSmart(in.SmartNeedID, "smart need id is invalid"); err != nil {
		return err
	}
	return nil
}

func validatePerson(in Person) error {
	if err := ident.Safe(in.AriaID, 64); err != nil {
		return verr("aria id is invalid")
	}
	if err := ident.Safe(in.IdempotencyKey, 200); err != nil {
		return verr("idempotency key is invalid")
	}
	if _, err := cleanName(in.Name); err != nil {
		return err
	}
	if _, err := requiredEmail(in.Email); err != nil {
		return err
	}
	return profileOK(in.LinkedInProfile)
}

func validateApplicant(in Applicant) error {
	if err := ident.Safe(in.AriaID, 64); err != nil {
		return verr("aria id is invalid")
	}
	if err := ident.Safe(in.IdempotencyKey, 200); err != nil {
		return verr("idempotency key is invalid")
	}
	if err := ident.Safe(in.JobAriaID, 64); err != nil {
		return verr("job id is invalid")
	}
	if _, err := cleanName(in.PartnerName); err != nil {
		return err
	}
	if _, err := requiredEmail(in.EmailFrom); err != nil {
		return err
	}
	if _, err := CanonicalSource(in.Source); err != nil {
		return err
	}
	if in.Priority < 0 || in.Priority > 3 {
		return verr("priority must be 0..3")
	}
	if in.Stage != "" && in.Stage != stage.ToRate {
		return verr("new applicants start at to_rate")
	}
	if _, err := optionalSmart(in.SmartNeedID, "smart need id is invalid"); err != nil {
		return err
	}
	if _, err := optionalSmart(in.SmartCandidateID, "smart candidate id is invalid"); err != nil {
		return err
	}
	return profileOK(in.LinkedInProfile)
}

func validateTouch(in Touch) error {
	if err := ident.Safe(in.IdempotencyKey, 200); err != nil {
		return verr("idempotency key is invalid")
	}
	if err := ident.Safe(in.ApplicantAriaID, 64); err != nil {
		return verr("applicant id is invalid")
	}
	if in.Channel != "email" && in.Channel != "note" {
		return verr("touch channel is invalid")
	}
	if in.Kind != "message" && in.Kind != "activity" {
		return verr("touch kind is invalid")
	}
	if strings.TrimSpace(in.Subject) == "" || len(in.Subject) > 200 {
		return verr("subject is required")
	}
	if strings.TrimSpace(in.Body) == "" || len(in.Body) > 8000 {
		return verr("body is required")
	}
	return nil
}

func validateContract(c Contract) error {
	if c.Filename == "" || len(c.Filename) > 120 || strings.Contains(c.Filename, "..") {
		return verr("contract filename is invalid")
	}
	for _, r := range c.Filename {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
		default:
			return verr("contract filename is invalid")
		}
	}
	if len(c.SHA256) != 64 {
		return verr("contract digest is invalid")
	}
	for _, r := range c.SHA256 {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f':
		default:
			return verr("contract digest is invalid")
		}
	}
	return nil
}
