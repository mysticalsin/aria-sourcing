// Package recruit is the Odoo-backed recruiting flow.
//
// It does not import the SMARTX seam. Odoo hr.recruitment is the system of
// record. Hired is reached only through the hire gate.
package recruit

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/ident"
	"github.com/mysticalsin/aria-sourcing/services/internal/ledger"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/synthetic"
)

// ErrRecipientNotAllowlisted means the recipient is not on ARIA_RECIPIENT_ALLOWLIST.
var ErrRecipientNotAllowlisted = errors.New("recipient is not on the allowlist")

// ErrTouchNotApproved means an outbound body has no matching ledger grant.
var ErrTouchNotApproved = errors.New("outbound touch has no matching approval")

// ErrTouchAfterHired means the applicant is already hired.
var ErrTouchAfterHired = errors.New("touches are closed after hired")

// ErrApplicantClosed means the applicant opted out, was erased, or is hired.
var ErrApplicantClosed = errors.New("applicant is closed to outreach")

// CampaignInput creates an hr.job and, when a client name is set, a company
// partner and a crm.lead opportunity.
type CampaignInput struct {
	AriaID         string
	IdempotencyKey string
	Name           string
	Description    string
	Openings       int
	ClientName     string
	SmartNeedID    string
}

// CandidateInput creates the person and the job application.
type CandidateInput struct {
	AriaID           string
	IdempotencyKey   string
	Name             string
	Email            string
	JobAriaID        string
	Source           string
	SmartNeedID      string
	SmartCandidateID string
	Priority         int
}

// ApprovalInput is the exact text Aria may grant. Odoo cannot supply it.
type ApprovalInput struct {
	Channel         string
	RecipientRef    string
	Subject         string
	Body            string
	NoticeVersion   string
	Approver        string
	ApplicantAriaID string
}

// Service orchestrates the fakes (or a future JSON-2 client) without SMARTX.
type Service struct {
	Odoo   odoo.Port
	DNA    dna.Adapter
	Ledger *ledger.Ledger
	Audit  *audit.Log
	allow  map[string]struct{}
	now    func() time.Time
}

// New builds the core flow. allowlist entries that are not synthetic emails
// are dropped, so a real address cannot become allowable.
func New(port odoo.Port, dnaAdapter dna.Adapter, led *ledger.Ledger, log *audit.Log, allowlist []string, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	allow := map[string]struct{}{}
	for _, raw := range allowlist {
		email, err := synthetic.Normalize(raw)
		if err != nil {
			continue
		}
		allow[email] = struct{}{}
	}
	return &Service{Odoo: port, DNA: dnaAdapter, Ledger: led, Audit: log, allow: allow, now: now}
}

// CreateCampaign writes the job and the optional client opportunity.
func (s *Service) CreateCampaign(ctx context.Context, in CampaignInput) (odoo.Job, error) {
	if err := ident.Safe(in.IdempotencyKey, 180); err != nil {
		return odoo.Job{}, fmt.Errorf("%w: idempotency key is invalid", odoo.ErrValidation)
	}
	job := odoo.Job{
		AriaID: in.AriaID, IdempotencyKey: in.IdempotencyKey,
		Name: in.Name, Description: in.Description, Openings: in.Openings,
		SmartNeedID: in.SmartNeedID,
	}
	if in.ClientName != "" {
		partner, err := s.Odoo.UpsertPartner(ctx, odoo.Partner{
			AriaID: in.AriaID + "-client", IdempotencyKey: in.IdempotencyKey + "-client",
			Name: in.ClientName, IsCompany: true,
		})
		if err != nil {
			return odoo.Job{}, err
		}
		lead, err := s.Odoo.UpsertLead(ctx, odoo.Lead{
			AriaID: in.AriaID + "-lead", IdempotencyKey: in.IdempotencyKey + "-lead",
			Name: in.Name, PartnerAriaID: partner.AriaID, Type: "opportunity",
		})
		if err != nil {
			return odoo.Job{}, err
		}
		job.PartnerAriaID = partner.AriaID
		job.LeadAriaID = lead.AriaID
	}
	return s.Odoo.UpsertJob(ctx, job)
}

// UpsertCandidate writes the person (version-shimmed) and the application.
func (s *Service) UpsertCandidate(ctx context.Context, in CandidateInput) (odoo.Applicant, error) {
	if err := ident.Safe(in.IdempotencyKey, 180); err != nil {
		return odoo.Applicant{}, fmt.Errorf("%w: idempotency key is invalid", odoo.ErrValidation)
	}
	if _, err := s.Odoo.UpsertPerson(ctx, odoo.Person{
		AriaID: in.AriaID + "-person", IdempotencyKey: in.IdempotencyKey + "-person",
		Name: in.Name, Email: in.Email,
	}); err != nil {
		return odoo.Applicant{}, err
	}
	return s.Odoo.UpsertApplicant(ctx, odoo.Applicant{
		AriaID: in.AriaID, IdempotencyKey: in.IdempotencyKey,
		PartnerName: in.Name, EmailFrom: in.Email, JobAriaID: in.JobAriaID,
		Source: in.Source, SmartNeedID: in.SmartNeedID, SmartCandidateID: in.SmartCandidateID,
		Priority: in.Priority,
	})
}

// Transition applies the stage graph. hired is delegated to Hire.
func (s *Service) Transition(ctx context.Context, ariaID, to string) (odoo.Applicant, error) {
	if to == stage.Hired {
		current, err := s.Odoo.ReadApplicant(ctx, ariaID)
		if err != nil {
			return odoo.Applicant{}, err
		}
		if err := s.Hire(ctx, ariaID); err != nil {
			return current, err
		}
		return s.Odoo.ReadApplicant(ctx, ariaID)
	}
	return s.Odoo.TransitionStage(ctx, ariaID, to)
}

// Hire refuses unless the applicant is on to_hire, a contract is attached,
// and DNA reports that contract integrated for the same candidate and need.
func (s *Service) Hire(ctx context.Context, ariaID string) error {
	app, err := s.Odoo.ReadApplicant(ctx, ariaID)
	if err != nil {
		return err
	}
	clearance, err := hiregate.Issue(ctx, hiregate.Snapshot{
		AriaID:           app.AriaID,
		Stage:            app.Stage,
		SmartCandidateID: app.SmartCandidateID,
		SmartNeedID:      app.SmartNeedID,
		ContractAttached: app.HasContract(),
	}, s.DNA)
	if err != nil {
		s.noteRefusal(ariaID)
		return err
	}
	_, err = s.Odoo.MarkHired(ctx, ariaID, clearance, s.DNA)
	return err
}

func (s *Service) noteRefusal(ariaID string) {
	if s.Audit == nil {
		return
	}
	_, _ = s.Audit.Append(audit.Entry{
		Action:         audit.ActionHireRefused,
		IdempotencyKey: "hire.refused." + ariaID + "." + fmt.Sprintf("%d", s.now().UnixNano()),
		AriaID:         ariaID,
		Model:          "hr.applicant",
		Detail:         "hired refused",
	})
}

// AttachContract stores the contract reference used by the hire gate.
func (s *Service) AttachContract(ctx context.Context, ariaID string, contract odoo.Contract) (odoo.Contract, error) {
	return s.Odoo.AttachContract(ctx, ariaID, contract)
}

// LogTouch records an outreach touch and one audit row.
// An email body is stored only when the ledger granted that exact text for
// this applicant. Opted-out, erased, and hired applicants are refused.
func (s *Service) LogTouch(ctx context.Context, in odoo.Touch) (odoo.Touch, error) {
	app, err := s.Odoo.ReadApplicant(ctx, in.ApplicantAriaID)
	if err != nil {
		return odoo.Touch{}, err
	}
	if err := closedApplicant(app); err != nil {
		return odoo.Touch{}, err
	}
	if in.Channel == "email" {
		sum := ledger.Hash(in.Channel, in.RecipientRef, in.Subject, in.Body, in.NoticeVersion, in.ApplicantAriaID)
		if s.Ledger == nil || !s.Ledger.Has(sum) {
			return odoo.Touch{}, ErrTouchNotApproved
		}
	}
	return s.Odoo.LogTouch(ctx, in)
}

func closedApplicant(app odoo.Applicant) error {
	if app.Stage == stage.Hired {
		return ErrTouchAfterHired
	}
	if app.OptedOut || app.Erased {
		return ErrApplicantClosed
	}
	return nil
}

// OptOut records an outreach refusal.
func (s *Service) OptOut(ctx context.Context, ariaID string) (odoo.Applicant, error) {
	return s.Odoo.OptOut(ctx, ariaID)
}

// Erase clears direct identifiers.
func (s *Service) Erase(ctx context.Context, ariaID string) (odoo.Applicant, error) {
	return s.Odoo.Erase(ctx, ariaID)
}

// Approve grants the exact text in the Aria ledger, then copies the fact to
// Odoo as an internal note. The note is not a grant.
func (s *Service) Approve(ctx context.Context, in ApprovalInput) (ledger.Approval, error) {
	email, err := synthetic.Normalize(in.RecipientRef)
	if err != nil {
		return ledger.Approval{}, err
	}
	if _, ok := s.allow[email]; !ok {
		return ledger.Approval{}, ErrRecipientNotAllowlisted
	}
	if in.Channel != "email" {
		return ledger.Approval{}, odoo.ErrValidation
	}
	app, err := s.Odoo.ReadApplicant(ctx, in.ApplicantAriaID)
	if err != nil {
		return ledger.Approval{}, err
	}
	if err := closedApplicant(app); err != nil {
		return ledger.Approval{}, err
	}
	row, err := s.Ledger.Approve(ledger.Request{
		Channel: in.Channel, RecipientRef: email, Subject: in.Subject, Body: in.Body,
		NoticeVersion: in.NoticeVersion, Approver: in.Approver, ApplicantAriaID: in.ApplicantAriaID,
	})
	if err != nil {
		return ledger.Approval{}, err
	}
	note := fmt.Sprintf(
		"Aria approval copy (this note does not grant approval)\napprover: %s\nat: %s\nsha256: %s\nchannel: %s\nrecipient: %s\nnotice: %s\napplicant: %s\n",
		row.Approver, row.At.Format(time.RFC3339), row.Hash, row.Channel, row.RecipientRef, row.NoticeVersion, row.ApplicantAriaID,
	)
	if _, err := s.Odoo.PostInternalNote(ctx, odoo.Note{
		IdempotencyKey: "approval." + row.Hash, ApplicantAriaID: in.ApplicantAriaID, Body: note,
	}); err != nil {
		return row, err
	}
	_, err = s.Audit.Append(audit.Entry{
		Action: audit.ActionApprovalMirror, IdempotencyKey: "approval." + row.Hash,
		AriaID: in.ApplicantAriaID, Model: "mail.message", Detail: "approval copy",
	})
	if errors.Is(err, audit.ErrDuplicate) {
		return row, nil
	}
	return row, err
}

// GrantFromOdoo never changes the ledger.
func (s *Service) GrantFromOdoo(note string) error {
	before := len(s.Ledger.List())
	err := s.Ledger.GrantFromOdoo(note)
	if len(s.Ledger.List()) != before {
		return errors.New("odoo note changed the aria ledger")
	}
	return err
}

// Applicants lists job applications.
func (s *Service) Applicants(ctx context.Context) ([]odoo.Applicant, error) {
	return s.Odoo.ListApplicants(ctx)
}

// Campaigns lists jobs.
func (s *Service) Campaigns(ctx context.Context) ([]odoo.Job, error) {
	return s.Odoo.ListJobs(ctx)
}

// Approvals lists ledger rows. Odoo notes are not included.
func (s *Service) Approvals() []ledger.Approval {
	return s.Ledger.List()
}
