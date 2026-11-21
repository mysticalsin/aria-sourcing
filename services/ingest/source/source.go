// Package source maps a Toast upload (CV source, job board, folder) onto
// Odoo utm.source / utm.medium / utm.campaign fields.
//
// The Odoo adapter is a separate module. This package is the contract it
// implements: Sink. Nothing here opens a network connection.
package source

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

// StageToRate is the Aria stage key for Smart's "To Rate" column. The Odoo
// adapter maps it onto hr.recruitment.stage; this package does not.
const StageToRate = "to_rate"

// ErrUnsanctioned means the CV source or job board is outside the closed list.
var ErrUnsanctioned = errors.New("unsanctioned_source")

// ErrUnknownFolder means the destination folder is not one of Toast's
// folder-mapping keys, or a key that needs a value did not get a slug.
var ErrUnknownFolder = errors.New("unknown_folder")

// ErrUnknownDocType means Type is not cv, cover-letter, or other.
var ErrUnknownDocType = errors.New("unknown_doc_type")

// Origin is the Toast upload context. Free text is stripped by Sanitize
// before it can reach the error queue: a person's name or email is not a
// valid slug, so it cannot become a utm value.
type Origin struct {
	// CVSource is how the file arrived: toast-upload, candidate-portal,
	// email, folder, referral, recruiter-export, rsc-ats, job-application.
	CVSource string
	// JobBoard is the board a recruiter copied the file from, when they say
	// so. It is a label on a file Aria already has. Aria does not call the
	// board. Empty when there is no board.
	JobBoard string
	// Folder is the Toast destination folder: holding, communities, country,
	// cv-source, or need.
	Folder string
	// FolderValue is the folder's slug (a country code, a community slug, a
	// synthetic need id). Holding ignores it. It must be a slug.
	FolderValue string
	// DocType is Toast's Type: cv, cover-letter, or other. Empty means cv.
	DocType string
}

// UTM is the Odoo utm.* triple plus the document type in Content.
type UTM struct {
	Source   string
	Medium   string
	Campaign string
	Content  string
}

// Mapping is what the adapter writes. OdooSource is the closed recruitment
// source label (not the job-board slug).
type Mapping struct {
	UTM        UTM
	OdooSource string
	Stage      string
}

// Applicant is the structured CV the adapter may copy onto hr.applicant.
// It is personal data. Logs must not include it.
type Applicant struct {
	Name       string
	Email      string
	Phone      string
	Location   string
	Skills     []string
	Languages  []string
	Experience []Role
}

// Role is one experience line on the applicant.
type Role struct {
	Title   string
	Company string
	Start   string
	End     string
}

// Record is one idempotent hand-off. IdempotencyKey is "cv:" + upload id.
// A second UpsertSource with the same key updates; it does not create.
type Record struct {
	IdempotencyKey string
	UploadID       string
	Stage          string
	UTM            UTM
	OdooSource     string
	DuplicateOf    string
	Applicant      Applicant
}

// Sink is the Odoo port. The adapter built in parallel implements it.
// UpsertSource must be idempotent on Record.IdempotencyKey.
type Sink interface {
	UpsertSource(ctx context.Context, rec Record) error
}

// Erasable is an optional Sink capability. Profile retention calls it so a
// copy of the applicant does not outlive the ingest store. Adapters that
// do not implement it still receive Schedule deadlines from the worker's
// retention hook; they just are not erased through this type assert.
type Erasable interface {
	EraseApplicant(ctx context.Context, uploadID string) error
}

// IdempotencyKey is the key the adapter stores with the outbox write.
func IdempotencyKey(uploadID string) string {
	return "cv:" + uploadID
}

type sourceSpec struct {
	medium string
	odoo   string
}

// Closed lists. A job board is a label on a recruiter-supplied file, not a
// live integration. linkedin-recruiter means "the recruiter uploaded a
// Recruiter export", which is the sanctioned CSV path — Aria still does
// not call linkedin.com.
var cvSources = map[string]sourceSpec{
	"toast-upload":     {medium: "cv-upload", odoo: "Candidate-supplied"},
	"candidate-portal": {medium: "cv-upload", odoo: "Candidate-supplied"},
	"email":            {medium: "email", odoo: "Candidate-supplied"},
	"folder":           {medium: "folder", odoo: "Candidate-supplied"},
	"referral":         {medium: "referral", odoo: "Candidate-supplied"},
	"recruiter-export": {medium: "recruiter-export", odoo: "LinkedIn Recruiter CSV"},
	"rsc-ats":          {medium: "ats", odoo: "RSC/ATS"},
	"job-application":  {medium: "job-application", odoo: "Job application"},
}

var jobBoards = map[string]struct{}{
	"indeed":                {},
	"welcome-to-the-jungle": {},
	"apec":                  {},
	"glassdoor":             {},
	"monster":               {},
	"talentio":              {},
	"linkedin-recruiter":    {},
}

var docTypes = map[string]struct{}{
	"cv":           {},
	"cover-letter": {},
	"other":        {},
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

// Sanitize lowercases each field and drops anything that is not a slug.
// Dropping is deliberate: the error queue stores the origin, and a queue
// row must not become a copy of the CV.
func Sanitize(o Origin) Origin {
	return Origin{
		CVSource:    keepSlug(o.CVSource),
		JobBoard:    keepSlug(o.JobBoard),
		Folder:      keepSlug(o.Folder),
		FolderValue: keepSlug(o.FolderValue),
		DocType:     keepSlug(o.DocType),
	}
}

func keepSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" || !slugRe.MatchString(s) {
		return ""
	}
	return s
}

// Map applies the Toast → UTM rules:
//
//	utm.source   = job board if set, otherwise the CV source
//	utm.medium   = "job-board" if a board is set, otherwise the CV-source medium
//	utm.campaign = the folder mapping (holding, communities:<slug>, ...)
//	utm.content  = the document type
//
// OdooSource stays the sanctioned recruitment label of the CV source even
// when a job board supplies utm.source. The board is provenance, not a new
// legal source.
func Map(in Origin) (Mapping, error) {
	o := Sanitize(in)
	spec, ok := cvSources[o.CVSource]
	if !ok {
		return Mapping{}, ErrUnsanctioned
	}
	if o.JobBoard != "" {
		if _, ok := jobBoards[o.JobBoard]; !ok {
			return Mapping{}, ErrUnsanctioned
		}
	}
	doc := o.DocType
	if doc == "" {
		doc = "cv"
	}
	if _, ok := docTypes[doc]; !ok {
		return Mapping{}, ErrUnknownDocType
	}
	campaign, err := campaignOf(o.Folder, o.FolderValue)
	if err != nil {
		return Mapping{}, err
	}
	utm := UTM{Campaign: campaign, Content: doc}
	if o.JobBoard != "" {
		utm.Source = o.JobBoard
		utm.Medium = "job-board"
	} else {
		utm.Source = o.CVSource
		utm.Medium = spec.medium
	}
	return Mapping{
		UTM:        utm,
		OdooSource: spec.odoo,
		Stage:      StageToRate,
	}, nil
}

func campaignOf(folder, value string) (string, error) {
	switch folder {
	case "holding":
		return "holding", nil
	case "communities", "country", "cv-source", "need":
		if value == "" {
			return "", ErrUnknownFolder
		}
		return folder + ":" + value, nil
	default:
		return "", ErrUnknownFolder
	}
}
