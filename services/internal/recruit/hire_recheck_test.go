package recruit_test

import (
	"context"
	"errors"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

// flipDNA reports integrated on the first read and not integrated after that,
// so a hire that checks DNA only before the write still commits.
type flipDNA struct {
	n int
}

func (f *flipDNA) ContractIntegration(_ context.Context, candidateID, needID string) (dna.Status, error) {
	f.n++
	return dna.Status{CandidateID: candidateID, NeedID: needID, Integrated: f.n == 1}, nil
}

func TestHireRechecksDNAAtWrite(t *testing.T) {
	s := newStack(t)
	s.svc.DNA = &flipDNA{}
	s.campaign(t)
	app := s.candidate(t, "ok", true)
	if _, err := s.svc.AttachContract(context.Background(), app.AriaID, odoo.Contract{
		Filename: "contract-mina.pdf", SHA256: digest,
	}); err != nil {
		t.Fatal(err)
	}
	reach(t, s.svc, app.AriaID, stage.ToHire)
	err := s.svc.Hire(context.Background(), app.AriaID)
	if !errors.Is(err, hiregate.ErrDNANotIntegrated) && !errors.Is(err, hiregate.ErrHireRefused) {
		t.Fatalf("err = %v", err)
	}
	live, readErr := s.fake.ReadApplicant(context.Background(), app.AriaID)
	if readErr != nil || live.Stage == stage.Hired {
		t.Fatalf("hired after DNA cleared: %+v %v", live, readErr)
	}
}
