package odoo

import "errors"

var (
	// ErrNotFound means the Aria id is not in the adapter.
	ErrNotFound = errors.New("odoo record not found")
	// ErrUnsanctionedSource means the source is outside the closed allowlist.
	ErrUnsanctionedSource = errors.New("source is not in the closed allowlist")
	// ErrConflict means two identities point at different Odoo rows.
	ErrConflict = errors.New("odoo identity conflict")
	// ErrValidation means the request is incomplete or not synthetic.
	ErrValidation = errors.New("validation failed")
)

// CanonicalSource returns the closed allowlist value or ErrUnsanctionedSource.
func CanonicalSource(s string) (string, error) {
	switch s {
	case "LinkedIn Recruiter CSV", "RSC/ATS", "Candidate-supplied", "Job application":
		return s, nil
	default:
		return "", ErrUnsanctionedSource
	}
}

func sourceSlug(s string) string {
	switch s {
	case "LinkedIn Recruiter CSV":
		return "linkedin_recruiter_csv"
	case "RSC/ATS":
		return "rsc_ats"
	case "Candidate-supplied":
		return "candidate_supplied"
	case "Job application":
		return "job_application"
	default:
		return ""
	}
}
