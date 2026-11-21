// Package odoo is the Aria adapter for Odoo 19 Community recruitment.
//
// Callers use Port. The in-memory Fake is what the service runs. Client speaks
// the External JSON-2 API (POST /json/2/<model>/<method>, bearer API key,
// optional X-Odoo-Database, named arguments only) and refuses to use the
// default HTTP client. UpsertPerson hides the Odoo 18 hr.candidate record
// behind the same Person result the Odoo 19 talent-pool applicant uses.
package odoo

import (
	"context"

	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
)

// Port is the recruitment system of record. SMARTX is not behind this port.
type Port interface {
	UpsertPartner(ctx context.Context, in Partner) (Partner, error)
	UpsertLead(ctx context.Context, in Lead) (Lead, error)
	UpsertJob(ctx context.Context, in Job) (Job, error)
	UpsertPerson(ctx context.Context, in Person) (Person, error)
	UpsertApplicant(ctx context.Context, in Applicant) (Applicant, error)
	ReadApplicant(ctx context.Context, ariaID string) (Applicant, error)
	ReadJob(ctx context.Context, ariaID string) (Job, error)
	ListApplicants(ctx context.Context) ([]Applicant, error)
	ListJobs(ctx context.Context) ([]Job, error)
	LogTouch(ctx context.Context, in Touch) (Touch, error)
	PostInternalNote(ctx context.Context, in Note) (Note, error)
	AttachContract(ctx context.Context, ariaID string, c Contract) (Contract, error)
	TransitionStage(ctx context.Context, ariaID, to string) (Applicant, error)
	// MarkHired re-checks the contract and DNA in the same critical section
	// as the stage write. checker must not call back into this port.
	MarkHired(ctx context.Context, ariaID string, clearance hiregate.Clearance, checker dna.Adapter) (Applicant, error)
	OptOut(ctx context.Context, ariaID string) (Applicant, error)
	Erase(ctx context.Context, ariaID string) (Applicant, error)
}
