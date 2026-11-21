package recruit_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/ledger"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/recruit"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func fixedNow() time.Time { return time.Date(2026, 11, 20, 15, 4, 5, 0, time.UTC) }

type stack struct {
	fake *odoo.Fake
	dna  *dna.Fake
	log  *audit.Log
	led  *ledger.Ledger
	svc  *recruit.Service
}

func newStack(t *testing.T) stack {
	t.Helper()
	log := audit.New(fixedNow)
	led := ledger.New(fixedNow)
	fake, err := odoo.NewFake("19", log, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	d := dna.NewFake()
	svc := recruit.New(fake, d, led, log, []string{"Mina.Ortega@People.example.test", "real.person@gmail.com"}, fixedNow)
	return stack{fake: fake, dna: d, log: log, led: led, svc: svc}
}

func (s stack) campaign(t *testing.T) odoo.Job {
	t.Helper()
	job, err := s.svc.CreateCampaign(context.Background(), recruit.CampaignInput{
		AriaID: "job-1", IdempotencyKey: "job-1", Name: "Plastic design synthetic",
		Description: "Synthetic brief", Openings: 1, ClientName: "Northwind Example",
		SmartNeedID: "need-1001",
	})
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func (s stack) candidate(t *testing.T, ariaID string, withKeys bool) odoo.Applicant {
	t.Helper()
	in := recruit.CandidateInput{
		AriaID: ariaID, IdempotencyKey: "cand-" + ariaID, Name: "Mina Ortega",
		Email: "mina.ortega+" + ariaID + "@people.example.test", JobAriaID: "job-1",
		Source: "RSC/ATS", Priority: 1,
	}
	if withKeys {
		in.SmartNeedID = "need-1001"
		in.SmartCandidateID = "cand-" + ariaID
	}
	app, err := s.svc.UpsertCandidate(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func reach(t *testing.T, svc *recruit.Service, ariaID, stop string) {
	t.Helper()
	for _, to := range []string{stage.ToAssess, stage.ToInterview, stage.Shoot, stage.QM, stage.ToHire} {
		if _, err := svc.Transition(context.Background(), ariaID, to); err != nil {
			t.Fatalf("transition to %s: %v", to, err)
		}
		if to == stop {
			return
		}
	}
}

const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func Test_test_go_refuses_hired_without_contract_and_dna(t *testing.T) {
	cases := []struct {
		name         string
		contract     bool
		dna          bool
		dnaErr       bool
		keys         bool
		wantContract bool
		wantDNA      bool
	}{
		{name: "neither contract nor dna", keys: true, wantContract: true, wantDNA: true},
		{name: "contract without dna", keys: true, contract: true, wantDNA: true},
		{name: "dna without contract", keys: true, dna: true, wantContract: true},
		{name: "dna read error fails closed", keys: true, contract: true, dnaErr: true, wantDNA: true},
		{name: "missing cross-keys", keys: false, contract: true, dna: true, wantDNA: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newStack(t)
			s.campaign(t)
			id := strings.ReplaceAll(tc.name, " ", "-")
			app := s.candidate(t, id, tc.keys)
			reach(t, s.svc, app.AriaID, stage.ToHire)
			if tc.contract {
				if _, err := s.svc.AttachContract(context.Background(), app.AriaID, odoo.Contract{
					Filename: "contract-mina.pdf", SHA256: digest,
				}); err != nil {
					t.Fatal(err)
				}
			}
			if tc.keys && tc.dna {
				s.dna.Seed("cand-"+app.AriaID, "need-1001", true)
			}
			if tc.dnaErr {
				s.dna.SetError(errors.New("dna unavailable canary-not-a-credential"))
			}
			err := s.svc.Hire(context.Background(), app.AriaID)
			if !errors.Is(err, hiregate.ErrHireRefused) {
				t.Fatal(err)
			}
			if tc.wantContract && !errors.Is(err, hiregate.ErrContractNotAttached) {
				t.Fatalf("missing contract error: %v", err)
			}
			if !tc.wantContract && errors.Is(err, hiregate.ErrContractNotAttached) {
				t.Fatalf("unexpected contract error: %v", err)
			}
			if tc.wantDNA && !errors.Is(err, hiregate.ErrDNANotIntegrated) {
				t.Fatalf("missing dna error: %v", err)
			}
			if err != nil && strings.Contains(err.Error(), "canary-not-a-credential") {
				t.Fatalf("dna error was copied: %v", err)
			}
			live, readErr := s.fake.ReadApplicant(context.Background(), app.AriaID)
			if readErr != nil || live.Stage != stage.ToHire {
				t.Fatalf("stage moved: %+v %v", live, readErr)
			}
		})
	}
}

func TestHireSucceedsOnlyFromToHireWithContractAndDNA(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.campaign(t)
	app := s.candidate(t, "ok", true)
	if _, err := s.svc.AttachContract(ctx, app.AriaID, odoo.Contract{Filename: "contract-mina.pdf", SHA256: digest}); err != nil {
		t.Fatal(err)
	}
	s.dna.Seed("cand-ok", "need-1001", true)
	if _, err := s.svc.Transition(ctx, app.AriaID, stage.Hired); !errors.Is(err, stage.ErrTransition) {
		t.Fatalf("hired from to_rate: %v", err)
	}
	reach(t, s.svc, app.AriaID, stage.ToHire)
	got, err := s.svc.Transition(ctx, app.AriaID, stage.Hired)
	if err != nil || got.Stage != stage.Hired {
		t.Fatalf("hire = %+v %v", got, err)
	}
	if _, err := s.svc.Transition(ctx, app.AriaID, stage.Rejected); !errors.Is(err, stage.ErrTransition) {
		t.Fatal(err)
	}
	if _, err := s.svc.Transition(ctx, app.AriaID, stage.ToAssess); err == nil {
		t.Fatal("terminal hired reopened")
	}
}

func TestPipelineAndExits(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.campaign(t)
	app := s.candidate(t, "walk", true)
	reach(t, s.svc, app.AriaID, stage.ToHire)
	if _, err := s.svc.Transition(ctx, app.AriaID, stage.Withdrawn); err != nil {
		t.Fatal(err)
	}
	other := s.candidate(t, "skip", true)
	if _, err := s.svc.Transition(ctx, other.AriaID, stage.QM); !errors.Is(err, stage.ErrTransition) {
		t.Fatal(err)
	}
	if _, err := s.svc.Transition(ctx, other.AriaID, stage.Rejected); err != nil {
		t.Fatal(err)
	}
}

func Test_test_approval_mirrored_as_note_never_grants(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.campaign(t)
	app := s.candidate(t, "appr", true)
	if err := s.svc.GrantFromOdoo("approved sha256:deadbeef"); err == nil || !errors.Is(err, ledger.ErrOdooCannotGrantApproval) {
		t.Fatal(err)
	}
	if len(s.led.List()) != 0 {
		t.Fatal("odoo granted an approval")
	}
	in := recruit.ApprovalInput{
		Channel: "email", RecipientRef: "MINA.ORTEGA@people.example.test",
		Subject: "Hello Mina", Body: "Synthetic exact text", NoticeVersion: "art14-2026-11",
		Approver: "ria.nunes", ApplicantAriaID: app.AriaID,
	}
	first, err := s.svc.Approve(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.svc.Approve(ctx, in)
	if err != nil || second.Hash != first.Hash || len(s.led.List()) != 1 {
		t.Fatalf("replay = %+v %v len=%d", second, err, len(s.led.List()))
	}
	notes := 0
	for _, msg := range s.fake.Messages() {
		if msg.Subtype != "mail.mt_note" {
			continue
		}
		notes++
		if msg.GrantsApproval || !strings.Contains(msg.Body, "does not grant approval") || !strings.Contains(msg.Body, first.Hash) {
			t.Fatalf("note = %+v", msg)
		}
	}
	if notes != 1 || s.fake.Counts().InternalNotes != 1 {
		t.Fatalf("notes=%d counts=%+v", notes, s.fake.Counts())
	}
	if err := s.svc.GrantFromOdoo(s.fake.Messages()[0].Body); !errors.Is(err, ledger.ErrOdooCannotGrantApproval) || len(s.led.List()) != 1 {
		t.Fatal(err)
	}
	edited := in
	edited.Body = "Synthetic exact text."
	if s.led.Has(ledger.Hash(edited.Channel, "mina.ortega@people.example.test", edited.Subject, edited.Body, edited.NoticeVersion)) {
		t.Fatal("edited body stayed approved")
	}
	if !s.led.Has(first.Hash) {
		t.Fatal("original grant disappeared")
	}
	blocked := in
	blocked.RecipientRef = "other.person@people.example.test"
	if _, err := s.svc.Approve(ctx, blocked); !errors.Is(err, recruit.ErrRecipientNotAllowlisted) || len(s.led.List()) != 1 {
		t.Fatal(err)
	}
	real := in
	real.RecipientRef = "real.person@gmail.com"
	if _, err := s.svc.Approve(ctx, real); err == nil {
		t.Fatal("real mailbox was allowlisted")
	}
	if _, err := s.svc.LogTouch(ctx, odoo.Touch{
		IdempotencyKey: "touch-appr", ApplicantAriaID: app.AriaID,
		Channel: "note", Kind: "message", Subject: "Call", Body: "Synthetic pre-call note",
	}); err != nil {
		t.Fatal(err)
	}
	touches := 0
	for _, entry := range s.log.Entries() {
		if entry.Action == audit.ActionTouch {
			touches++
		}
	}
	if touches != 1 {
		t.Fatalf("audit touches = %d", touches)
	}
}

func TestLogTouchRefusedAfterHire(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.campaign(t)
	app := s.candidate(t, "closed", true)
	reach(t, s.svc, app.AriaID, stage.ToHire)
	if _, err := s.svc.AttachContract(ctx, app.AriaID, odoo.Contract{Filename: "contract-synthetic.pdf", SHA256: digest}); err != nil {
		t.Fatal(err)
	}
	s.dna.Seed("cand-closed", "need-1001", true)
	if _, err := s.svc.Transition(ctx, app.AriaID, stage.Hired); err != nil {
		t.Fatal(err)
	}
	if _, err := s.svc.LogTouch(ctx, odoo.Touch{
		IdempotencyKey:  "touch-hired",
		ApplicantAriaID: app.AriaID,
		Channel:         "email",
		Kind:            "message",
		Subject:         "Synthetic",
		Body:            "Synthetic outreach after the gate.",
	}); err == nil {
		t.Fatal("hired applicant accepted an outreach touch")
	}
}

func TestCampaignWritesPartnerLeadAndJob(t *testing.T) {
	s := newStack(t)
	job := s.campaign(t)
	if job.UserID == 0 || job.LeadID == 0 || job.PartnerID == 0 || job.SmartNeedID != "need-1001" {
		t.Fatalf("job = %+v", job)
	}
	model, _, ok := s.fake.XMLID("smart_need_need-1001")
	if !ok || model != "hr.job" {
		t.Fatalf("need key = %s %v", model, ok)
	}
	model, _, ok = s.fake.XMLID("lead_job-1-lead")
	if !ok || model != "crm.lead" {
		t.Fatalf("lead = %s %v", model, ok)
	}
}
