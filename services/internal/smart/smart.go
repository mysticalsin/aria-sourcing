// Package smart is an optional import/export seam for a future official
// SMARTX exchange.
//
// There is no SMARTX API access. Odoo hr.recruitment is the system of record
// and rebuilds the Smart pipeline. The recruiting core does not import this
// package. This fake stores copies in memory. It does not scrape ARP, does
// not call the network, and does not hire anyone.
package smart

import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/mysticalsin/aria-sourcing/services/internal/ident"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/synthetic"
)

// ErrNoAutomation means the record looks like a UI scrape or a live URL.
var ErrNoAutomation = errors.New("smart seam refuses automation and scraped records")

// ErrNotFound means the copy is not in the fake.
var ErrNotFound = errors.New("smart copy not found")

// ErrValidation means the copy is not a canonical stage record.
var ErrValidation = errors.New("smart copy is invalid")

// Record is a portable copy. Stage is a canonical key, never a display label.
type Record struct {
	NeedID      string
	CandidateID string
	Stage       string
	Email       string
	Name        string
}

// Adapter is the future import/export port. Core flow must not require it.
type Adapter interface {
	ImportCopy(ctx context.Context, in Record) (Record, error)
	ExportCopy(ctx context.Context, needID, candidateID string) (Record, error)
}

// Fake stores copies. It has no Odoo client and no HTTP client.
type Fake struct {
	mu   sync.Mutex
	rows map[string]Record
}

// NewFake returns an empty seam.
func NewFake() *Fake {
	return &Fake{rows: map[string]Record{}}
}

// ImportCopy validates and stores a copy. It does not write Odoo and it does
// not advance a hire gate.
func (f *Fake) ImportCopy(ctx context.Context, in Record) (Record, error) {
	if err := ctx.Err(); err != nil {
		return Record{}, err
	}
	cleaned, err := validate(in)
	if err != nil {
		return Record{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rows[pair(cleaned.NeedID, cleaned.CandidateID)] = cleaned
	return cleaned, nil
}

// ExportCopy returns a previously imported copy.
func (f *Fake) ExportCopy(ctx context.Context, needID, candidateID string) (Record, error) {
	if err := ctx.Err(); err != nil {
		return Record{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.rows[pair(needID, candidateID)]
	if !ok {
		return Record{}, ErrNotFound
	}
	return row, nil
}

func validate(in Record) (Record, error) {
	if err := ident.Safe(in.NeedID, 64); err != nil {
		return Record{}, ErrValidation
	}
	if err := ident.Safe(in.CandidateID, 64); err != nil {
		return Record{}, ErrValidation
	}
	if !stage.Known(in.Stage) {
		return Record{}, ErrValidation
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 200 {
		return Record{}, ErrValidation
	}
	email, err := synthetic.Normalize(in.Email)
	if err != nil {
		return Record{}, ErrValidation
	}
	in.Name = name
	in.Email = email
	if err := rejectAutomation(in); err != nil {
		return Record{}, err
	}
	return in, nil
}

func rejectAutomation(in Record) error {
	blob := strings.ToLower(strings.Join([]string{in.NeedID, in.CandidateID, in.Stage, in.Email, in.Name}, " "))
	banned := []string{"arp.mantu.com", "http://", "https://", "voyager", "selenium", "playwright"}
	for _, word := range banned {
		if strings.Contains(blob, word) {
			return ErrNoAutomation
		}
	}
	return nil
}

func pair(needID, candidateID string) string {
	return needID + "\x00" + candidateID
}
