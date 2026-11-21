package odoo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/outbox"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

type xmlRef struct {
	Model string
	ResID int64
}

// Fake is an in-memory Odoo 19 (or 18) recruitment database.
// It does not open a network connection.
type Fake struct {
	mu      sync.Mutex
	version string
	next    int64
	now     func() time.Time
	audit   *audit.Log
	box     *outbox.Box

	userID   int64
	mediumID int64

	partners        map[int64]Partner
	partnerByAria   map[string]int64
	partnerByEmail  map[string]int64
	leads           map[int64]Lead
	leadByAria      map[string]int64
	jobs            map[int64]Job
	jobByAria       map[string]int64
	jobOrder        []int64
	people          map[string]Person
	personModel     map[string]string
	applicants      map[int64]Applicant
	applicantByAria map[string]int64
	applicantOrder  []int64
	emailJob        map[string]int64
	stages          map[string]int64
	utmSources      map[string]int64
	utmCampaigns    map[string]int64
	recSources      map[string]int64
	messages        []Message
	activities      []Activity
	attachments     []Contract
	xml             map[string]xmlRef
}

// NewFake builds a fake for version 18 or 19. An empty version is 19.
// log receives one audit row per new outreach touch.
func NewFake(version string, log *audit.Log, now func() time.Time) (*Fake, error) {
	ver, err := NormalizeVersion(version)
	if err != nil {
		return nil, err
	}
	if log == nil {
		return nil, verr("audit log is required")
	}
	if now == nil {
		now = time.Now
	}
	f := &Fake{
		version:         ver,
		now:             now,
		audit:           log,
		box:             outbox.New(),
		partners:        map[int64]Partner{},
		partnerByAria:   map[string]int64{},
		partnerByEmail:  map[string]int64{},
		leads:           map[int64]Lead{},
		leadByAria:      map[string]int64{},
		jobs:            map[int64]Job{},
		jobByAria:       map[string]int64{},
		people:          map[string]Person{},
		personModel:     map[string]string{},
		applicants:      map[int64]Applicant{},
		applicantByAria: map[string]int64{},
		emailJob:        map[string]int64{},
		stages:          map[string]int64{},
		utmSources:      map[string]int64{},
		utmCampaigns:    map[string]int64{},
		recSources:      map[string]int64{},
		xml:             map[string]xmlRef{},
	}
	f.userID = f.alloc()
	f.mediumID = f.alloc()
	f.xml["medium_aria"] = xmlRef{Model: "utm.medium", ResID: f.mediumID}
	for _, key := range stage.Keys() {
		id := f.alloc()
		f.stages[key] = id
		f.xml["stage_"+key] = xmlRef{Model: "hr.recruitment.stage", ResID: id}
	}
	return f, nil
}

func (f *Fake) alloc() int64 {
	f.next++
	return f.next
}

// Version is the major version this fake is pretending to be.
func (f *Fake) Version() string { return f.version }

// PersonStorageModel reports which Odoo model holds the person.
// It is an observer for the version shim. Port callers do not use it.
func (f *Fake) PersonStorageModel(ariaID string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	model, ok := f.personModel[ariaID]
	return model, ok
}

// XMLID resolves an ir.model.data name in module aria.
func (f *Fake) XMLID(name string) (model string, resID int64, ok bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ref, ok := f.xml[name]
	return ref.Model, ref.ResID, ok
}

// Counts returns sizes. Notes and outreach messages are counted apart.
func (f *Fake) Counts() Counts {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := Counts{
		Partners:    len(f.partners),
		Leads:       len(f.leads),
		Jobs:        len(f.jobs),
		Persons:     len(f.people),
		Applicants:  len(f.applicants),
		Activities:  len(f.activities),
		Attachments: len(f.attachments),
		XMLIDs:      len(f.xml),
		Outbox:      f.box.Len(),
	}
	for _, msg := range f.messages {
		if msg.Subtype == "mail.mt_note" {
			c.InternalNotes++
		} else {
			c.OutreachMessages++
		}
	}
	return c
}

// Messages returns a copy of mail.message rows.
func (f *Fake) Messages() []Message {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Message, len(f.messages))
	copy(out, f.messages)
	return out
}

// Activities returns a copy of mail.activity rows.
func (f *Fake) Activities() []Activity {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Activity, len(f.activities))
	copy(out, f.activities)
	return out
}

// UpsertPartner writes res.partner.
func (f *Fake) UpsertPartner(ctx context.Context, in Partner) (Partner, error) {
	if err := ctx.Err(); err != nil {
		return Partner{}, err
	}
	if err := validatePartner(in); err != nil {
		return Partner{}, err
	}
	name, _ := cleanName(in.Name)
	email, _ := optionalEmail(in.Email)
	in.Name = name
	in.Email = email
	f.mu.Lock()
	defer f.mu.Unlock()
	var cached Partner
	if ok, err := f.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	row, err := f.finishPartner(in)
	if err != nil {
		return Partner{}, err
	}
	if err := f.box.Store(in.IdempotencyKey, row); err != nil {
		return Partner{}, err
	}
	return row, nil
}

func (f *Fake) finishPartner(in Partner) (Partner, error) {
	if id, ok := f.partnerByAria[in.AriaID]; ok {
		row := f.partners[id]
		row.Name = in.Name
		row.IsCompany = in.IsCompany
		if in.Email != "" {
			row.Email = in.Email
			f.partnerByEmail[in.Email] = id
		}
		f.partners[id] = row
		return row, nil
	}
	if in.Email != "" {
		if id, ok := f.partnerByEmail[in.Email]; ok {
			row := f.partners[id]
			f.partnerByAria[in.AriaID] = id
			f.xml["partner_"+in.AriaID] = xmlRef{Model: "res.partner", ResID: id}
			row.Name = in.Name
			f.partners[id] = row
			return row, nil
		}
	}
	id := f.alloc()
	row := Partner{ID: id, AriaID: in.AriaID, IdempotencyKey: in.IdempotencyKey, Name: in.Name, Email: in.Email, IsCompany: in.IsCompany}
	f.partners[id] = row
	f.partnerByAria[in.AriaID] = id
	if in.Email != "" {
		f.partnerByEmail[in.Email] = id
	}
	f.xml["partner_"+in.AriaID] = xmlRef{Model: "res.partner", ResID: id}
	return row, nil
}

// UpsertLead writes crm.lead with type opportunity.
func (f *Fake) UpsertLead(ctx context.Context, in Lead) (Lead, error) {
	if err := ctx.Err(); err != nil {
		return Lead{}, err
	}
	if err := validateLead(in); err != nil {
		return Lead{}, err
	}
	name, _ := cleanName(in.Name)
	in.Name = name
	if in.Type == "" {
		in.Type = "opportunity"
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var cached Lead
	if ok, err := f.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	if in.PartnerAriaID != "" {
		pid, ok := f.partnerByAria[in.PartnerAriaID]
		if !ok {
			return Lead{}, ErrNotFound
		}
		in.PartnerID = pid
	}
	if id, ok := f.leadByAria[in.AriaID]; ok {
		row := f.leads[id]
		row.Name = in.Name
		row.PartnerID = in.PartnerID
		row.Type = "opportunity"
		f.leads[id] = row
		_ = f.box.Store(in.IdempotencyKey, row)
		return row, nil
	}
	id := f.alloc()
	row := Lead{ID: id, AriaID: in.AriaID, IdempotencyKey: in.IdempotencyKey, Name: in.Name, PartnerID: in.PartnerID, PartnerAriaID: in.PartnerAriaID, Type: "opportunity"}
	f.leads[id] = row
	f.leadByAria[in.AriaID] = id
	f.xml["lead_"+in.AriaID] = xmlRef{Model: "crm.lead", ResID: id}
	_ = f.box.Store(in.IdempotencyKey, row)
	return row, nil
}

// UpsertJob writes hr.job and a utm.campaign.
func (f *Fake) UpsertJob(ctx context.Context, in Job) (Job, error) {
	if err := ctx.Err(); err != nil {
		return Job{}, err
	}
	if err := validateJob(in); err != nil {
		return Job{}, err
	}
	name, _ := cleanName(in.Name)
	in.Name = name
	if in.Openings == 0 {
		in.Openings = 1
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var cached Job
	if ok, err := f.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	if in.PartnerAriaID != "" {
		pid, ok := f.partnerByAria[in.PartnerAriaID]
		if !ok {
			return Job{}, ErrNotFound
		}
		in.PartnerID = pid
	}
	if in.LeadAriaID != "" {
		lid, ok := f.leadByAria[in.LeadAriaID]
		if !ok {
			return Job{}, ErrNotFound
		}
		in.LeadID = lid
	}
	if in.SmartNeedID != "" {
		if ref, ok := f.xml["smart_need_"+in.SmartNeedID]; ok {
			if existing, exists := f.jobByAria[in.AriaID]; !exists || ref.ResID != existing {
				if _, isThis := f.jobByAria[in.AriaID]; !isThis {
					return Job{}, ErrConflict
				}
			}
		}
	}
	var row Job
	if id, ok := f.jobByAria[in.AriaID]; ok {
		row = f.jobs[id]
		row.Name = in.Name
		row.Description = in.Description
		row.Openings = in.Openings
		row.PartnerID = in.PartnerID
		row.PartnerAriaID = in.PartnerAriaID
		row.SmartNeedID = in.SmartNeedID
		row.LeadID = in.LeadID
		row.LeadAriaID = in.LeadAriaID
		f.jobs[id] = row
	} else {
		id := f.alloc()
		row = Job{
			ID: id, AriaID: in.AriaID, IdempotencyKey: in.IdempotencyKey,
			Name: in.Name, Description: in.Description, Openings: in.Openings,
			UserID: f.userID, PartnerID: in.PartnerID, PartnerAriaID: in.PartnerAriaID,
			SmartNeedID: in.SmartNeedID, LeadID: in.LeadID, LeadAriaID: in.LeadAriaID,
		}
		f.jobs[id] = row
		f.jobByAria[in.AriaID] = id
		f.jobOrder = append(f.jobOrder, id)
		f.xml["job_"+in.AriaID] = xmlRef{Model: "hr.job", ResID: id}
	}
	if _, ok := f.utmCampaigns[in.Name]; !ok {
		cid := f.alloc()
		f.utmCampaigns[in.Name] = cid
		f.xml["campaign_"+in.AriaID] = xmlRef{Model: "utm.campaign", ResID: cid}
	}
	if in.SmartNeedID != "" {
		f.xml["smart_need_"+in.SmartNeedID] = xmlRef{Model: "hr.job", ResID: row.ID}
	}
	_ = f.box.Store(in.IdempotencyKey, row)
	return row, nil
}

// UpsertPerson writes res.partner plus either hr.candidate (18) or a
// jobless hr.applicant talent-pool row (19). The returned Person has no model field.
func (f *Fake) UpsertPerson(ctx context.Context, in Person) (Person, error) {
	if err := ctx.Err(); err != nil {
		return Person{}, err
	}
	if err := validatePerson(in); err != nil {
		return Person{}, err
	}
	name, _ := cleanName(in.Name)
	email, _ := requiredEmail(in.Email)
	in.Name = name
	in.Email = email
	in.EmailNormalized = email
	f.mu.Lock()
	defer f.mu.Unlock()
	var cached Person
	if ok, err := f.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	partner, err := f.finishPartner(Partner{
		AriaID: "person-" + in.AriaID, IdempotencyKey: in.IdempotencyKey + ":partner",
		Name: in.Name, Email: email, IsCompany: false,
	})
	if err != nil {
		return Person{}, err
	}
	model := PersonRecordModel(f.version)
	if prev, ok := f.people[in.AriaID]; ok {
		prev.Name = in.Name
		prev.Email = email
		prev.EmailNormalized = email
		prev.LinkedInProfile = in.LinkedInProfile
		prev.PartnerID = partner.ID
		f.people[in.AriaID] = prev
		_ = f.box.Store(in.IdempotencyKey, prev)
		return prev, nil
	}
	id := f.alloc()
	row := Person{
		ID: id, AriaID: in.AriaID, IdempotencyKey: in.IdempotencyKey,
		Name: in.Name, Email: email, EmailNormalized: email,
		LinkedInProfile: in.LinkedInProfile, PartnerID: partner.ID,
	}
	f.people[in.AriaID] = row
	f.personModel[in.AriaID] = model
	f.xml["person_"+in.AriaID] = xmlRef{Model: model, ResID: id}
	_ = f.box.Store(in.IdempotencyKey, row)
	return row, nil
}

// UpsertApplicant writes hr.applicant idempotently.
// The same idempotency key replays the first result and does not write.
// The same normalized email and job updates the existing row instead of creating another.
func (f *Fake) UpsertApplicant(ctx context.Context, in Applicant) (Applicant, error) {
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	if err := validateApplicant(in); err != nil {
		return Applicant{}, err
	}
	name, _ := cleanName(in.PartnerName)
	email, _ := requiredEmail(in.EmailFrom)
	in.PartnerName = name
	in.EmailFrom = email
	in.EmailNormalized = email
	f.mu.Lock()
	defer f.mu.Unlock()
	var cached Applicant
	if ok, err := f.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	jobID, ok := f.jobByAria[in.JobAriaID]
	if !ok {
		return Applicant{}, ErrNotFound
	}
	emailKey := email + "\x00" + fmt.Sprint(jobID)
	if id, ok := f.emailJob[emailKey]; ok && f.applicants[id].AriaID != in.AriaID {
		return Applicant{}, ErrConflict
	}
	sourceID, err := f.ensureSourceLocked(jobID, in.Source)
	if err != nil {
		return Applicant{}, err
	}
	partner, err := f.finishPartner(Partner{
		AriaID: "applicant-partner-" + in.AriaID, IdempotencyKey: in.IdempotencyKey + ":partner",
		Name: in.PartnerName, Email: email, IsCompany: false,
	})
	if err != nil {
		return Applicant{}, err
	}
	var existing int64
	var found bool
	if id, ok := f.applicantByAria[in.AriaID]; ok {
		existing, found = id, true
	}
	if id, ok := f.emailJob[emailKey]; ok {
		existing, found = id, true
	}
	if found {
		row := f.applicants[existing]
		row.PartnerName = in.PartnerName
		row.EmailFrom = email
		row.EmailNormalized = email
		row.Source = in.Source
		row.SourceID = sourceID
		row.Priority = in.Priority
		row.LinkedInProfile = in.LinkedInProfile
		row.PartnerID = partner.ID
		row.SmartNeedID = in.SmartNeedID
		row.SmartCandidateID = in.SmartCandidateID
		f.storeApplicant(row, in.AriaID)
		_ = f.box.Store(in.IdempotencyKey, row.clone())
		return row.clone(), nil
	}
	id := f.alloc()
	row := Applicant{
		ID: id, AriaID: in.AriaID, IdempotencyKey: in.IdempotencyKey,
		PartnerName: in.PartnerName, EmailFrom: email, EmailNormalized: email,
		JobID: jobID, JobAriaID: in.JobAriaID,
		StageID: f.stages[stage.ToRate], Stage: stage.ToRate,
		SourceID: sourceID, Source: in.Source, MediumID: f.mediumID,
		Priority: in.Priority, LinkedInProfile: in.LinkedInProfile, PartnerID: partner.ID,
		SmartNeedID: in.SmartNeedID, SmartCandidateID: in.SmartCandidateID,
	}
	f.applicants[id] = row
	f.applicantOrder = append(f.applicantOrder, id)
	f.storeApplicant(row, in.AriaID)
	_ = f.box.Store(in.IdempotencyKey, row.clone())
	return row.clone(), nil
}

func (f *Fake) storeApplicant(row Applicant, alsoAria string) {
	f.applicants[row.ID] = row
	f.applicantByAria[row.AriaID] = row.ID
	if alsoAria != "" {
		f.applicantByAria[alsoAria] = row.ID
		f.xml["applicant_"+alsoAria] = xmlRef{Model: "hr.applicant", ResID: row.ID}
	}
	f.xml["applicant_"+row.AriaID] = xmlRef{Model: "hr.applicant", ResID: row.ID}
	f.emailJob[row.EmailNormalized+"\x00"+fmt.Sprint(row.JobID)] = row.ID
	if row.SmartCandidateID != "" {
		if partner, ok := f.partners[row.PartnerID]; ok {
			f.xml["smart_candidate_"+row.SmartCandidateID] = xmlRef{Model: "res.partner", ResID: partner.ID}
		}
	}
}

// ReadApplicant returns a copy of the applicant for an Aria id.
func (f *Fake) ReadApplicant(ctx context.Context, ariaID string) (Applicant, error) {
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.applicantByAria[ariaID]
	if !ok {
		return Applicant{}, ErrNotFound
	}
	return f.applicants[id].clone(), nil
}

// ReadJob returns a copy of the job for an Aria id.
func (f *Fake) ReadJob(ctx context.Context, ariaID string) (Job, error) {
	if err := ctx.Err(); err != nil {
		return Job{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.jobByAria[ariaID]
	if !ok {
		return Job{}, ErrNotFound
	}
	return f.jobs[id], nil
}

// ListApplicants returns job applications in insert order.
func (f *Fake) ListApplicants(ctx context.Context) ([]Applicant, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Applicant, 0, len(f.applicantOrder))
	for _, id := range f.applicantOrder {
		out = append(out, f.applicants[id].clone())
	}
	return out, nil
}

// ListJobs returns jobs in insert order.
func (f *Fake) ListJobs(ctx context.Context) ([]Job, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Job, 0, len(f.jobOrder))
	for _, id := range f.jobOrder {
		out = append(out, f.jobs[id])
	}
	return out, nil
}

// LogTouch writes mail.message or mail.activity and one audit row.
// A repeated idempotency key returns the first touch and writes nothing.
func (f *Fake) LogTouch(ctx context.Context, in Touch) (Touch, error) {
	if err := ctx.Err(); err != nil {
		return Touch{}, err
	}
	if err := validateTouch(in); err != nil {
		return Touch{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var cached Touch
	if ok, err := f.box.Load(in.IdempotencyKey, &cached); err != nil {
		return Touch{}, err
	} else if ok {
		if cached.ApplicantAriaID != in.ApplicantAriaID || cached.Body != in.Body {
			return Touch{}, ErrConflict
		}
		return cached, nil
	}
	appID, ok := f.applicantByAria[in.ApplicantAriaID]
	if !ok {
		return Touch{}, ErrNotFound
	}
	app := f.applicants[appID]
	switch in.Kind {
	case "message":
		msg := Message{
			ID: f.alloc(), ResModel: "hr.applicant", ResID: app.ID,
			Body: in.Body, Subject: in.Subject, Subtype: "mail.mt_comment",
			MessageType: "comment", GrantsApproval: false,
			IdempotencyKey: in.IdempotencyKey, ApplicantAriaID: in.ApplicantAriaID,
		}
		f.messages = append(f.messages, msg)
		in.OdooID = msg.ID
		in.Model = "mail.message"
	case "activity":
		act := Activity{
			ID: f.alloc(), ResModel: "hr.applicant", ResID: app.ID,
			Summary: in.Subject, Note: in.Body,
			IdempotencyKey: in.IdempotencyKey, ApplicantAriaID: in.ApplicantAriaID,
		}
		f.activities = append(f.activities, act)
		in.OdooID = act.ID
		in.Model = "mail.activity"
	}
	if _, err := f.audit.Append(audit.Entry{
		Action: audit.ActionTouch, IdempotencyKey: in.IdempotencyKey,
		AriaID: in.ApplicantAriaID, Model: in.Model,
		Detail: "channel=" + in.Channel + ";kind=" + in.Kind,
	}); err != nil {
		return Touch{}, err
	}
	if err := f.box.Store(in.IdempotencyKey, in); err != nil {
		return Touch{}, err
	}
	return in, nil
}

// PostInternalNote stores a mail.mt_note copy. GrantsApproval is forced false.
func (f *Fake) PostInternalNote(ctx context.Context, in Note) (Note, error) {
	if err := ctx.Err(); err != nil {
		return Note{}, err
	}
	if in.IdempotencyKey == "" || in.ApplicantAriaID == "" || strings.TrimSpace(in.Body) == "" {
		return Note{}, verr("internal note is incomplete")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	var cached Note
	if ok, err := f.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	appID, ok := f.applicantByAria[in.ApplicantAriaID]
	if !ok {
		return Note{}, ErrNotFound
	}
	msg := Message{
		ID: f.alloc(), ResModel: "hr.applicant", ResID: f.applicants[appID].ID,
		Body: in.Body, Subtype: "mail.mt_note", MessageType: "comment",
		GrantsApproval: false, IdempotencyKey: in.IdempotencyKey,
		ApplicantAriaID: in.ApplicantAriaID,
	}
	f.messages = append(f.messages, msg)
	in.OdooID = msg.ID
	if err := f.box.Store(in.IdempotencyKey, in); err != nil {
		return Note{}, err
	}
	return in, nil
}

// AttachContract stores an ir.attachment reference on the applicant.
func (f *Fake) AttachContract(ctx context.Context, ariaID string, c Contract) (Contract, error) {
	if err := ctx.Err(); err != nil {
		return Contract{}, err
	}
	if err := validateContract(c); err != nil {
		return Contract{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.applicantByAria[ariaID]
	if !ok {
		return Contract{}, ErrNotFound
	}
	row := f.applicants[id]
	if row.Contract != nil && row.Contract.SHA256 == c.SHA256 && row.Contract.Filename == c.Filename {
		return *row.Contract, nil
	}
	att := Contract{
		ID: f.alloc(), Filename: c.Filename, SHA256: c.SHA256,
		ResModel: "hr.applicant", ResID: row.ID,
	}
	f.attachments = append(f.attachments, att)
	row.Contract = &att
	f.applicants[id] = row
	return att, nil
}

// TransitionStage moves along the explicit graph. hired is refused here.
func (f *Fake) TransitionStage(ctx context.Context, ariaID, to string) (Applicant, error) {
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	if to == stage.Hired {
		return Applicant{}, hiregate.ErrHiredRequiresGate
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	row, err := f.mustApplicant(ariaID)
	if err != nil {
		return Applicant{}, err
	}
	if err := stage.Allow(row.Stage, to); err != nil {
		return Applicant{}, err
	}
	row.Stage = to
	row.StageID = f.stages[to]
	f.applicants[row.ID] = row
	return row.clone(), nil
}

// MarkHired writes hired only for a clearance the hire gate issued, and only
// when the contract is still attached and the stage edge allows it.
func (f *Fake) MarkHired(ctx context.Context, ariaID string, clearance hiregate.Clearance, checker dna.Adapter) (Applicant, error) {
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	if !clearance.ValidFor(ariaID) {
		return Applicant{}, hiregate.ErrHireRefused
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	row, err := f.mustApplicant(ariaID)
	if err != nil {
		return Applicant{}, err
	}
	if err := stage.Allow(row.Stage, stage.Hired); err != nil {
		return Applicant{}, err
	}
	var parts []error
	if !row.HasContract() {
		parts = append(parts, hiregate.ErrContractNotAttached)
	}
	if !dnaIntegrated(ctx, checker, row.SmartCandidateID, row.SmartNeedID) {
		parts = append(parts, hiregate.ErrDNANotIntegrated)
	}
	if len(parts) > 0 {
		return Applicant{}, errors.Join(append([]error{hiregate.ErrHireRefused}, parts...)...)
	}
	row.Stage = stage.Hired
	row.StageID = f.stages[stage.Hired]
	f.applicants[row.ID] = row
	_, _ = f.audit.Append(audit.Entry{
		Action: audit.ActionHired, IdempotencyKey: "stage.hired." + ariaID,
		AriaID: ariaID, Model: "hr.applicant", Detail: "hired",
	})
	return row.clone(), nil
}

func dnaIntegrated(ctx context.Context, checker dna.Adapter, candidateID, needID string) bool {
	if checker == nil || candidateID == "" || needID == "" {
		return false
	}
	status, err := checker.ContractIntegration(ctx, candidateID, needID)
	if err != nil {
		return false
	}
	return status.Integrated && status.CandidateID == candidateID && status.NeedID == needID
}

// OptOut records that the applicant refused further outreach.
func (f *Fake) OptOut(ctx context.Context, ariaID string) (Applicant, error) {
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	row, err := f.mustApplicant(ariaID)
	if err != nil {
		return Applicant{}, err
	}
	row.OptedOut = true
	f.applicants[row.ID] = row
	return row.clone(), nil
}

// Erase removes direct identifiers and closes the applicant.
func (f *Fake) Erase(ctx context.Context, ariaID string) (Applicant, error) {
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	row, err := f.mustApplicant(ariaID)
	if err != nil {
		return Applicant{}, err
	}
	delete(f.emailJob, row.EmailNormalized+"\x00"+fmt.Sprint(row.JobID))
	row.Erased = true
	row.PartnerName = ""
	row.EmailFrom = ""
	row.EmailNormalized = ""
	row.LinkedInProfile = ""
	f.applicants[row.ID] = row
	return row.clone(), nil
}

func (f *Fake) mustApplicant(ariaID string) (Applicant, error) {
	id, ok := f.applicantByAria[ariaID]
	if !ok {
		return Applicant{}, ErrNotFound
	}
	return f.applicants[id], nil
}

func (f *Fake) ensureSourceLocked(jobID int64, name string) (int64, error) {
	canonical, err := CanonicalSource(name)
	if err != nil {
		return 0, err
	}
	id, ok := f.utmSources[canonical]
	if !ok {
		id = f.alloc()
		f.utmSources[canonical] = id
		f.xml["source_"+sourceSlug(canonical)] = xmlRef{Model: "utm.source", ResID: id}
	}
	recKey := fmt.Sprintf("%d\x00%s", jobID, canonical)
	if _, ok := f.recSources[recKey]; !ok {
		rid := f.alloc()
		f.recSources[recKey] = rid
		f.xml[fmt.Sprintf("recruitment_source_%d_%s", jobID, sourceSlug(canonical))] = xmlRef{Model: "hr.recruitment.source", ResID: rid}
	}
	return id, nil
}
