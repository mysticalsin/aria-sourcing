package odoo

import "github.com/mysticalsin/aria-sourcing/services/internal/stage"

// Partner is a res.partner row.
type Partner struct {
	ID             int64
	AriaID         string
	IdempotencyKey string
	Name           string
	Email          string
	IsCompany      bool
}

// Lead is a crm.lead opportunity.
type Lead struct {
	ID             int64
	AriaID         string
	IdempotencyKey string
	Name           string
	PartnerID      int64
	PartnerAriaID  string
	Type           string
}

// Job is an hr.job row. SmartNeedID is the cross-key for a future SMARTX need.
type Job struct {
	ID             int64
	AriaID         string
	IdempotencyKey string
	Name           string
	Description    string
	Openings       int
	UserID         int64
	PartnerID      int64
	PartnerAriaID  string
	SmartNeedID    string
	LeadID         int64
	LeadAriaID     string
}

// Person is the talent record. Callers do not choose hr.candidate or hr.applicant.
type Person struct {
	ID              int64
	AriaID          string
	IdempotencyKey  string
	Name            string
	Email           string
	EmailNormalized string
	LinkedInProfile string
	PartnerID       int64
}

// Contract is an ir.attachment reference. The bytes stay out of this service.
type Contract struct {
	ID       int64
	Filename string
	SHA256   string
	ResModel string
	ResID    int64
}

// Applicant is an hr.applicant in a job. Stage is a canonical key.
type Applicant struct {
	ID               int64
	AriaID           string
	IdempotencyKey   string
	PartnerName      string
	EmailFrom        string
	EmailNormalized  string
	JobID            int64
	JobAriaID        string
	StageID          int64
	Stage            string
	SourceID         int64
	Source           string
	MediumID         int64
	Priority         int
	LinkedInProfile  string
	PartnerID        int64
	SmartNeedID      string
	SmartCandidateID string
	Contract         *Contract
}

// HasContract reports whether a filename and digest are stored.
func (a Applicant) HasContract() bool {
	return a.Contract != nil && a.Contract.Filename != "" && len(a.Contract.SHA256) == 64
}

// Touch is one outreach touch, written as mail.message or mail.activity.
type Touch struct {
	IdempotencyKey  string
	ApplicantAriaID string
	Channel         string
	Kind            string
	Subject         string
	Body            string
	OdooID          int64
	Model           string
}

// Note is an internal mail.message copy. It cannot grant approval.
type Note struct {
	IdempotencyKey  string
	ApplicantAriaID string
	Body            string
	OdooID          int64
}

// Message is a stored mail.message. GrantsApproval is always false.
type Message struct {
	ID              int64
	ResModel        string
	ResID           int64
	Body            string
	Subject         string
	Subtype         string
	MessageType     string
	GrantsApproval  bool
	IdempotencyKey  string
	ApplicantAriaID string
}

// Activity is a stored mail.activity.
type Activity struct {
	ID              int64
	ResModel        string
	ResID           int64
	Summary         string
	Note            string
	IdempotencyKey  string
	ApplicantAriaID string
}

// Counts is a point-in-time size of the fake.
type Counts struct {
	Partners         int
	Leads            int
	Jobs             int
	Persons          int
	Applicants       int
	OutreachMessages int
	Activities       int
	InternalNotes    int
	Attachments      int
	XMLIDs           int
	Outbox           int
}

func (a Applicant) clone() Applicant {
	out := a
	if a.Contract != nil {
		c := *a.Contract
		out.Contract = &c
	}
	return out
}

func (a Applicant) stageKey() string {
	if a.Stage == "" {
		return stage.ToRate
	}
	return a.Stage
}
