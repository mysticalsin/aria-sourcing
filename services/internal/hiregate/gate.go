// Package hiregate decides whether a candidate may enter hired.
//
// The graph in package stage allows to_hire -> hired. That edge is not
// enough. Issue returns a clearance only when a contract is attached and
// DNA reports the contract integrated for the same candidate and need.
// A zero Clearance cannot be turned into a valid one from another package.
package hiregate

import (
	"context"
	"errors"

	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

var (
	// ErrHireRefused means hired was refused.
	ErrHireRefused = errors.New("hired transition refused")
	// ErrContractNotAttached means no contract reference is stored.
	ErrContractNotAttached = errors.New("contract is not attached")
	// ErrDNANotIntegrated means DNA did not report the contract integrated.
	ErrDNANotIntegrated = errors.New("dna contract is not integrated")
	// ErrHiredRequiresGate means a caller tried to write hired without a clearance.
	ErrHiredRequiresGate = errors.New("hired transition requires the hire gate")
)

// Snapshot is the applicant fact the gate needs. It is not an Odoo model.
type Snapshot struct {
	AriaID           string
	Stage            string
	SmartCandidateID string
	SmartNeedID      string
	ContractAttached bool
}

// Clearance is proof that Issue passed. Other packages cannot set the
// unexported fields, so they cannot forge a clearance.
type Clearance struct {
	ok          bool
	ariaID      string
	candidateID string
	needID      string
}

// ValidFor reports whether the clearance was issued for this applicant.
func (c Clearance) ValidFor(ariaID string) bool {
	return c.ok && c.ariaID != "" && c.ariaID == ariaID
}

// CandidateID returns the candidate id the gate checked.
func (c Clearance) CandidateID() string {
	if !c.ok {
		return ""
	}
	return c.candidateID
}

// NeedID returns the need id the gate checked.
func (c Clearance) NeedID() string {
	if !c.ok {
		return ""
	}
	return c.needID
}

// Issue checks the stage edge, the contract, and DNA. On success the
// clearance is bound to the applicant and to the cross-keys DNA confirmed.
func Issue(ctx context.Context, app Snapshot, d dna.Adapter) (Clearance, error) {
	if err := ctx.Err(); err != nil {
		return Clearance{}, err
	}
	if err := stage.Allow(app.Stage, stage.Hired); err != nil {
		return Clearance{}, err
	}
	var parts []error
	if !app.ContractAttached {
		parts = append(parts, ErrContractNotAttached)
	}
	if !integrated(ctx, app, d) {
		parts = append(parts, ErrDNANotIntegrated)
	}
	if len(parts) > 0 {
		return Clearance{}, errors.Join(append([]error{ErrHireRefused}, parts...)...)
	}
	return Clearance{
		ok:          true,
		ariaID:      app.AriaID,
		candidateID: app.SmartCandidateID,
		needID:      app.SmartNeedID,
	}, nil
}

func integrated(ctx context.Context, app Snapshot, d dna.Adapter) bool {
	if d == nil || app.SmartCandidateID == "" || app.SmartNeedID == "" {
		return false
	}
	status, err := d.ContractIntegration(ctx, app.SmartCandidateID, app.SmartNeedID)
	if err != nil {
		return false
	}
	return status.Integrated && status.CandidateID == app.SmartCandidateID && status.NeedID == app.SmartNeedID
}
