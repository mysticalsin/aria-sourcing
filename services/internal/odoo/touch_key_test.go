package odoo_test

import (
	"context"
	"errors"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
)

func TestTouchKeyConflictOnDifferentApplicantOrBody(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	mustJob(t, f)
	app, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		t.Fatal(err)
	}
	other := applicantInput()
	other.AriaID = "cand-b"
	other.IdempotencyKey = "idem-bea"
	other.EmailFrom = "bea.costa@people.example.test"
	if _, err := f.UpsertApplicant(ctx, other); err != nil {
		t.Fatal(err)
	}
	first := odoo.Touch{
		IdempotencyKey: "touch-k", ApplicantAriaID: app.AriaID,
		Channel: "note", Kind: "message", Subject: "Hello", Body: "Synthetic note",
	}
	if _, err := f.LogTouch(ctx, first); err != nil {
		t.Fatal(err)
	}
	changed := first
	changed.Body = "Different synthetic note"
	if _, err := f.LogTouch(ctx, changed); !errors.Is(err, odoo.ErrConflict) {
		t.Fatalf("body change err = %v", err)
	}
	moved := first
	moved.ApplicantAriaID = "cand-b"
	if _, err := f.LogTouch(ctx, moved); !errors.Is(err, odoo.ErrConflict) {
		t.Fatalf("applicant change err = %v", err)
	}
	if f.Counts().OutreachMessages != 1 {
		t.Fatalf("messages = %d", f.Counts().OutreachMessages)
	}
}
