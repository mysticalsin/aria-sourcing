package odoo_test

import (
	"context"
	"errors"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

func TestDistinctAriaIDDoesNotOverwriteApplicant(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	mustJob(t, f)
	firstIn := applicantInput()
	first, err := f.UpsertApplicant(ctx, firstIn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.TransitionStage(ctx, first.AriaID, stage.ToAssess); err != nil {
		t.Fatal(err)
	}
	if _, err := f.AttachContract(ctx, first.AriaID, odoo.Contract{
		Filename: "contract-mina.pdf",
		SHA256:   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}); err != nil {
		t.Fatal(err)
	}
	second := firstIn
	second.AriaID = "cand-b"
	second.IdempotencyKey = "idem-bea"
	second.PartnerName = "Bea Costa"
	second.EmailFrom = first.EmailNormalized
	if _, err := f.UpsertApplicant(ctx, second); !errors.Is(err, odoo.ErrConflict) {
		t.Fatalf("err = %v, want conflict", err)
	}
	live, err := f.ReadApplicant(ctx, "cand-1")
	if err != nil {
		t.Fatal(err)
	}
	if live.PartnerName != "Mina Ortega" || live.Stage != stage.ToAssess || !live.HasContract() {
		t.Fatalf("first applicant was overwritten: %+v", live)
	}
	if _, err := f.ReadApplicant(ctx, "cand-b"); !errors.Is(err, odoo.ErrNotFound) {
		t.Fatalf("second id stored on the first row: %v", err)
	}
	if f.Counts().Applicants != 1 {
		t.Fatalf("applicants = %d", f.Counts().Applicants)
	}
}
