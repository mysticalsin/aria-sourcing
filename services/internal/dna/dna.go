// Package dna is the seam to DNA, Mantu's ERP, for contract integration.
//
// This package has no network client and no credential fields. The fake is
// seeded by tests. A later Odoo addon enforces the same gate inside Odoo.
package dna

import (
	"context"
	"sync"
)

// Status is the contract-integration fact for one candidate on one need.
type Status struct {
	CandidateID string
	NeedID      string
	Integrated  bool
}

// Adapter reads contract-integration status. Implementations must not dial.
type Adapter interface {
	ContractIntegration(ctx context.Context, candidateID, needID string) (Status, error)
}

// Fake is an in-memory DNA adapter.
type Fake struct {
	mu         sync.Mutex
	integrated map[string]bool
	err        error
}

// NewFake returns a fake where every pair is not integrated.
func NewFake() *Fake {
	return &Fake{integrated: map[string]bool{}}
}

// Seed records the integration flag for a candidate/need pair.
func (f *Fake) Seed(candidateID, needID string, integrated bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.integrated[pairKey(candidateID, needID)] = integrated
}

// SetError makes the next reads fail closed with err. The hire gate must not
// copy err into its own error text.
func (f *Fake) SetError(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

// ContractIntegration returns the seeded flag. An unknown pair is not integrated.
func (f *Fake) ContractIntegration(ctx context.Context, candidateID, needID string) (Status, error) {
	if err := ctx.Err(); err != nil {
		return Status{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return Status{}, f.err
	}
	return Status{
		CandidateID: candidateID,
		NeedID:      needID,
		Integrated:  f.integrated[pairKey(candidateID, needID)],
	}, nil
}

func pairKey(candidateID, needID string) string {
	return candidateID + "\x00" + needID
}
