package recruit_test

import (
	"context"
	"errors"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/ledger"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/recruit"
)

const specificBody = "Ada, the example ledger you published in 2024 is the piece I want to talk about, including the hash binding and the audit trail you kept."

func emailTouch(app odoo.Applicant, key, body string) odoo.Touch {
	return odoo.Touch{
		IdempotencyKey: key, ApplicantAriaID: app.AriaID,
		Channel: "email", Kind: "message", Subject: "Hello", Body: body,
		RecipientRef: "mina.ortega@people.example.test", NoticeVersion: "art14-lgpd-2026-11",
	}
}

func TestFullAutoStaysOffUntilOptInAndKillSwitchStopsIt(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.campaign(t)
	app := s.candidate(t, "auto", true)
	touch := emailTouch(app, "auto-1", specificBody)

	if mode := s.svc.SendMode("job-1", "email"); mode != "manual" {
		t.Fatalf("default mode = %s", mode)
	}
	if _, err := s.svc.RecordQualityCheck(ctx, recruit.ApprovalInput{
		Channel: "email", RecipientRef: "Mina.Ortega@people.example.test",
		Subject: "Hello", Body: specificBody, NoticeVersion: "art14-lgpd-2026-11",
		ApplicantAriaID: app.AriaID,
	}, "qc-stub"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.svc.LogTouch(ctx, touch); !errors.Is(err, recruit.ErrTouchNotApproved) {
		t.Fatalf("qc without opt-in err = %v", err)
	}
	if s.led.Has(ledger.Hash("email", "mina.ortega@people.example.test", "Hello", specificBody, "art14-lgpd-2026-11", app.AriaID)) {
		t.Fatal("qc pass granted a ledger approval")
	}
	if err := s.svc.GrantFromOdoo("Aria QC copy (this note does not grant approval)"); !errors.Is(err, ledger.ErrOdooCannotGrantApproval) {
		t.Fatalf("odoo note err = %v", err)
	}
	before := s.fake.Counts().OutreachMessages

	if err := s.svc.EnableFullAuto(ctx, "job-1", "email"); err != nil {
		t.Fatal(err)
	}
	if s.svc.SendMode("job-1", "email") != "automatic" || s.svc.SendMode("job-1", "note") != "manual" {
		t.Fatal("opt-in was not limited to the email channel")
	}
	if s.fake.Counts().OutreachMessages != before {
		t.Fatal("opt-in wrote an outreach message")
	}

	other := s.candidate(t, "other", true)
	if _, err := s.svc.CreateCampaign(ctx, recruit.CampaignInput{
		AriaID: "job-2", IdempotencyKey: "job-2", Name: "Second synthetic",
		Description: "Synthetic brief", Openings: 1,
	}); err != nil {
		t.Fatal(err)
	}
	moved, err := s.svc.UpsertCandidate(ctx, recruit.CandidateInput{
		AriaID: "else", IdempotencyKey: "cand-else", Name: "Mina Ortega",
		Email: "mina.ortega+else@people.example.test", JobAriaID: "job-2",
		Source: "RSC/ATS", Priority: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.svc.RecordQualityCheck(ctx, recruit.ApprovalInput{
		Channel: "email", RecipientRef: "mina.ortega@people.example.test",
		Subject: "Hello", Body: specificBody, NoticeVersion: "art14-lgpd-2026-11",
		ApplicantAriaID: moved.AriaID,
	}, "qc-stub"); err != nil {
		t.Fatal(err)
	}
	elseTouch := emailTouch(moved, "else-1", specificBody)
	if _, err := s.svc.LogTouch(ctx, elseTouch); !errors.Is(err, recruit.ErrTouchNotApproved) {
		t.Fatalf("other campaign err = %v", err)
	}

	if _, err := s.svc.LogTouch(ctx, touch); err != nil {
		t.Fatal(err)
	}
	if s.fake.Counts().OutreachMessages != before+1 {
		t.Fatalf("outreach = %d", s.fake.Counts().OutreachMessages)
	}
	for _, msg := range s.fake.Messages() {
		if msg.GrantsApproval {
			t.Fatal("a message granted approval")
		}
	}

	edited := emailTouch(app, "auto-edited", specificBody+" One more sentence about the example role.")
	if _, err := s.svc.LogTouch(ctx, edited); !errors.Is(err, recruit.ErrQCRequired) {
		t.Fatalf("edited body err = %v", err)
	}
	borrowed := emailTouch(other, "auto-borrowed", specificBody)
	if _, err := s.svc.LogTouch(ctx, borrowed); !errors.Is(err, recruit.ErrQCRequired) {
		t.Fatalf("other applicant err = %v", err)
	}

	generic := emailTouch(app, "auto-generic", "I hope this email finds you well. I came across your profile and wanted to reach out about an exciting opportunity.")
	if _, err := s.svc.RecordQualityCheck(ctx, recruit.ApprovalInput{
		Channel: "email", RecipientRef: "mina.ortega@people.example.test",
		Subject: "Hello", Body: generic.Body, NoticeVersion: "art14-lgpd-2026-11",
		ApplicantAriaID: app.AriaID,
	}, "qc-stub"); !errors.Is(err, recruit.ErrQCRejected) {
		t.Fatalf("generic err = %v", err)
	}
	if _, err := s.svc.LogTouch(ctx, generic); !errors.Is(err, recruit.ErrQCRequired) {
		t.Fatalf("generic touch err = %v", err)
	}

	s.svc.SetKillSwitch(true)
	stopped := emailTouch(app, "auto-stopped", specificBody)
	if _, err := s.svc.LogTouch(ctx, stopped); !errors.Is(err, recruit.ErrKillSwitch) {
		t.Fatalf("kill switch err = %v", err)
	}
	if s.fake.Counts().OutreachMessages != before+1 {
		t.Fatal("kill switch wrote an outreach message")
	}
	if _, err := s.svc.Approve(ctx, recruit.ApprovalInput{
		Channel: "email", RecipientRef: "mina.ortega@people.example.test",
		Subject: "Hello", Body: specificBody, NoticeVersion: "art14-lgpd-2026-11",
		Approver: "ria.nunes", ApplicantAriaID: app.AriaID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.svc.LogTouch(ctx, emailTouch(app, "human-stopped", specificBody)); !errors.Is(err, recruit.ErrKillSwitch) {
		t.Fatalf("human path under kill switch err = %v", err)
	}

	if err := s.svc.EnableFullAuto(ctx, "missing", "email"); !errors.Is(err, odoo.ErrNotFound) {
		t.Fatalf("missing campaign err = %v", err)
	}
	if err := s.svc.EnableFullAuto(ctx, "job-1", "LinkedIn"); !errors.Is(err, odoo.ErrValidation) {
		t.Fatalf("linkedin opt-in err = %v", err)
	}
	found := false
	for _, entry := range s.log.Entries() {
		if entry.Action == audit.ActionKillSwitch && entry.Detail == "engaged" {
			found = true
		}
		if entry.Detail == specificBody || entry.Detail == generic.Body {
			t.Fatal("audit detail contained a message body")
		}
	}
	if !found {
		t.Fatal("kill switch was not audited")
	}
}
