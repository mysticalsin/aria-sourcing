package recruit_test

import (
	"context"
	"errors"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/recruit"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

func TestEmailTouchRequiresMatchingGrantAndHiredIsClosed(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.campaign(t)
	app := s.candidate(t, "ok", true)
	touch := odoo.Touch{
		IdempotencyKey: "tm", ApplicantAriaID: app.AriaID,
		Channel: "email", Kind: "message", Subject: "Hello", Body: "Synthetic exact text",
		RecipientRef: "mina.ortega@people.example.test", NoticeVersion: "art14-lgpd-2026-11",
	}
	if _, err := s.svc.LogTouch(ctx, touch); !errors.Is(err, recruit.ErrTouchNotApproved) {
		t.Fatalf("ungranted touch err = %v", err)
	}
	if _, err := s.svc.Approve(ctx, recruit.ApprovalInput{
		Channel: "email", RecipientRef: "mina.ortega@people.example.test",
		Subject: "Hello", Body: "Synthetic exact text", NoticeVersion: "art14-lgpd-2026-11",
		Approver: "ria.nunes", ApplicantAriaID: app.AriaID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.svc.LogTouch(ctx, touch); err != nil {
		t.Fatal(err)
	}
	reach(t, s.svc, app.AriaID, stage.ToHire)
	if _, err := s.svc.AttachContract(ctx, app.AriaID, odoo.Contract{Filename: "contract-mina.pdf", SHA256: digest}); err != nil {
		t.Fatal(err)
	}
	s.dna.Seed("cand-ok", "need-1001", true)
	if _, err := s.svc.Transition(ctx, app.AriaID, stage.Hired); err != nil {
		t.Fatal(err)
	}
	again := touch
	again.IdempotencyKey = "ta"
	if _, err := s.svc.LogTouch(ctx, again); !errors.Is(err, recruit.ErrTouchAfterHired) {
		t.Fatalf("hired touch err = %v", err)
	}
}
