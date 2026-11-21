package odoo_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func fixedNow() time.Time { return time.Date(2026, 11, 20, 15, 4, 5, 0, time.UTC) }

func newFake(t testing.TB, version string) (*odoo.Fake, *audit.Log) {
	t.Helper()
	log := audit.New(fixedNow)
	f, err := odoo.NewFake(version, log, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	return f, log
}

func mustJob(t testing.TB, f *odoo.Fake) odoo.Job {
	t.Helper()
	job, err := f.UpsertJob(context.Background(), odoo.Job{
		AriaID: "job-1", IdempotencyKey: "job-1", Name: "Plastic design synthetic",
		Description: "Synthetic brief", Openings: 2, SmartNeedID: "need-1001",
	})
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func applicantInput() odoo.Applicant {
	return odoo.Applicant{
		AriaID: "cand-1", IdempotencyKey: "idem-a",
		PartnerName: "Mina Ortega", EmailFrom: "Mina.Ortega@People.example.test",
		JobAriaID: "job-1", Source: "Candidate-supplied",
		SmartNeedID: "need-1001", SmartCandidateID: "cand-2002", Priority: 2,
	}
}

func Test_test_odoo_upsert_applicant_is_idempotent(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	mustJob(t, f)
	in := applicantInput()
	first, err := f.UpsertApplicant(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	in.PartnerName = "Someone Else"
	in.EmailFrom = "other.person@people.example.test"
	second, err := f.UpsertApplicant(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == 0 || second.ID != first.ID || second.PartnerName != first.PartnerName || second.EmailNormalized != first.EmailNormalized {
		t.Fatalf("replay changed the row: first=%+v second=%+v", first, second)
	}
	if f.Counts().Applicants != 1 || f.Counts().Outbox < 1 {
		t.Fatalf("counts = %+v", f.Counts())
	}
	model, resID, ok := f.XMLID("applicant_cand-1")
	if !ok || model != "hr.applicant" || resID != first.ID {
		t.Fatalf("xmlid = %s %d %v", model, resID, ok)
	}
	again, err := f.UpsertApplicant(ctx, in)
	if err != nil || again.ID != first.ID || f.Counts().Applicants != 1 {
		t.Fatalf("third replay applicants=%d id=%d err=%v", f.Counts().Applicants, again.ID, err)
	}
}

func TestSearchBeforeCreateDoesNotDuplicateOrResetStage(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	mustJob(t, f)
	first, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.TransitionStage(ctx, first.AriaID, stage.ToAssess); err != nil {
		t.Fatal(err)
	}
	next := applicantInput()
	next.IdempotencyKey = "idem-b"
	next.PartnerName = "Mina O."
	got, err := f.UpsertApplicant(ctx, next)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != first.ID || f.Counts().Applicants != 1 {
		t.Fatalf("created a duplicate: %+v count=%d", got, f.Counts().Applicants)
	}
	live, err := f.ReadApplicant(ctx, first.AriaID)
	if err != nil || live.Stage != stage.ToAssess || live.PartnerName != "Mina O." {
		t.Fatalf("live = %+v %v", live, err)
	}
	// Replaying the original key must not roll the stage back.
	replayed, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		t.Fatal(err)
	}
	live, _ = f.ReadApplicant(ctx, first.AriaID)
	if live.Stage != stage.ToAssess || f.Counts().Applicants != 1 {
		t.Fatalf("replay rewrote the live row: returned=%s live=%+v", replayed.Stage, live)
	}
}

func TestReplayWithoutDuplicates(t *testing.T) {
	ctx := context.Background()
	f, log := newFake(t, "19")
	mustJob(t, f)
	app, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		t.Fatal(err)
	}
	touch := odoo.Touch{
		IdempotencyKey: "touch-1", ApplicantAriaID: app.AriaID,
		Channel: "email", Kind: "message", Subject: "Hello", Body: "Synthetic outreach body",
	}
	first, err := f.LogTouch(ctx, touch)
	if err != nil {
		t.Fatal(err)
	}
	note, err := f.PostInternalNote(ctx, odoo.Note{
		IdempotencyKey: "approval.abc", ApplicantAriaID: app.AriaID, Body: "copy",
	})
	if err != nil {
		t.Fatal(err)
	}
	before := f.Counts()
	auditBefore := len(log.Entries())
	if _, err := f.UpsertApplicant(ctx, applicantInput()); err != nil {
		t.Fatal(err)
	}
	second, err := f.LogTouch(ctx, touch)
	if err != nil {
		t.Fatal(err)
	}
	note2, err := f.PostInternalNote(ctx, odoo.Note{
		IdempotencyKey: "approval.abc", ApplicantAriaID: app.AriaID, Body: "copy changed",
	})
	if err != nil {
		t.Fatal(err)
	}
	after := f.Counts()
	if after != before {
		t.Fatalf("replay changed counts: before=%+v after=%+v", before, after)
	}
	if len(log.Entries()) != auditBefore {
		t.Fatalf("audit grew on replay: %d -> %d", auditBefore, len(log.Entries()))
	}
	if second.OdooID != first.OdooID || note2.OdooID != note.OdooID || note2.Body != note.Body {
		t.Fatalf("replay returned a new write: touch %d/%d note %+v/%+v", first.OdooID, second.OdooID, note, note2)
	}
}

func TestAuditLogWritePerTouch(t *testing.T) {
	ctx := context.Background()
	f, log := newFake(t, "19")
	mustJob(t, f)
	app, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		t.Fatal(err)
	}
	for i, kind := range []string{"message", "activity"} {
		key := "touch-" + kind
		got, err := f.LogTouch(ctx, odoo.Touch{
			IdempotencyKey: key, ApplicantAriaID: app.AriaID,
			Channel: "email", Kind: kind, Subject: "Hello", Body: "Synthetic body " + kind,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.LogTouch(ctx, odoo.Touch{
			IdempotencyKey: key, ApplicantAriaID: app.AriaID,
			Channel: "email", Kind: kind, Subject: "Hello", Body: "Synthetic body " + kind,
		}); err != nil {
			t.Fatal(err)
		}
		entry, ok := log.ByKey(key)
		if !ok || entry.Action != audit.ActionTouch || entry.Model != got.Model {
			t.Fatalf("audit %d = %+v", i, entry)
		}
	}
	touches := 0
	for _, entry := range log.Entries() {
		if entry.Action == audit.ActionTouch {
			touches++
		}
	}
	if touches != 2 || f.Counts().OutreachMessages != 1 || f.Counts().Activities != 1 {
		t.Fatalf("touches=%d counts=%+v", touches, f.Counts())
	}
	if _, err := f.PostInternalNote(ctx, odoo.Note{
		IdempotencyKey: "note-1", ApplicantAriaID: app.AriaID, Body: "not a touch",
	}); err != nil {
		t.Fatal(err)
	}
	touches = 0
	for _, entry := range log.Entries() {
		if entry.Action == audit.ActionTouch {
			touches++
		}
	}
	if touches != 2 || f.Counts().InternalNotes != 1 {
		t.Fatalf("note counted as a touch: touches=%d counts=%+v", touches, f.Counts())
	}
	for _, msg := range f.Messages() {
		if msg.GrantsApproval {
			t.Fatal("mail.message granted approval")
		}
	}
	mutated := log.Entries()
	mutated = append(mutated, audit.Entry{Action: "forged"})
	if len(log.Entries()) == len(mutated) {
		t.Fatal("audit slice is not a copy")
	}
}

func Test_test_odoo_rejects_unsanctioned_source(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	mustJob(t, f)
	for _, source := range []string{"Apify", "LinkedIn scrape", "ARP", "Kaspr", ""} {
		in := applicantInput()
		in.IdempotencyKey = "bad-source"
		in.AriaID = "cand-bad"
		in.Source = source
		if _, err := f.UpsertApplicant(ctx, in); !errors.Is(err, odoo.ErrUnsanctionedSource) && source != "" {
			if source == "" && err == nil {
				t.Fatal("empty source accepted")
			}
			if source != "" {
				t.Fatalf("source %q err=%v", source, err)
			}
		}
	}
	if f.Counts().Applicants != 0 {
		t.Fatalf("unsanctioned source created %d applicants", f.Counts().Applicants)
	}
	in := applicantInput()
	if _, err := f.UpsertApplicant(ctx, in); err != nil {
		t.Fatal(err)
	}
	model, _, ok := f.XMLID("source_candidate_supplied")
	if !ok || model != "utm.source" {
		t.Fatalf("utm source missing: %s %v", model, ok)
	}
}

func TestUpsertPersonHidesCandidateModel(t *testing.T) {
	ctx := context.Background()
	put := func(t *testing.T, p odoo.Port) odoo.Person {
		t.Helper()
		got, err := p.UpsertPerson(ctx, odoo.Person{
			AriaID: "person-1", IdempotencyKey: "person-1",
			Name: "Mina Ortega", Email: "mina.ortega@people.example.test",
		})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	f18, _ := newFake(t, "18")
	f19, _ := newFake(t, "19")
	a := put(t, f18)
	b := put(t, f19)
	if a.EmailNormalized == "" || b.EmailNormalized == "" || a.Name != b.Name {
		t.Fatalf("person results diverged: %+v %+v", a, b)
	}
	if model, _ := f18.PersonStorageModel("person-1"); model != "hr.candidate" {
		t.Fatalf("v18 model = %s", model)
	}
	if model, _ := f19.PersonStorageModel("person-1"); model != "hr.applicant" {
		t.Fatalf("v19 model = %s", model)
	}
}

func TestCrossKeysResolveNeedAndCandidate(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	job := mustJob(t, f)
	app, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		t.Fatal(err)
	}
	model, resID, ok := f.XMLID("smart_need_need-1001")
	if !ok || model != "hr.job" || resID != job.ID {
		t.Fatalf("need xmlid = %s %d %v", model, resID, ok)
	}
	model, resID, ok = f.XMLID("smart_candidate_cand-2002")
	if !ok || model != "res.partner" || resID == 0 || resID != app.PartnerID {
		t.Fatalf("candidate xmlid = %s %d partner=%d ok=%v", model, resID, app.PartnerID, ok)
	}
	if app.SmartNeedID != "need-1001" || app.SmartCandidateID != "cand-2002" {
		t.Fatalf("cross-keys missing on applicant: %+v", app)
	}
}

func TestTransitionGuardsOnTheAdapter(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	mustJob(t, f)
	app, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.TransitionStage(ctx, app.AriaID, stage.Shoot); !errors.Is(err, stage.ErrTransition) {
		t.Fatal(err)
	}
	if _, err := f.TransitionStage(ctx, app.AriaID, stage.Hired); !errors.Is(err, hiregate.ErrHiredRequiresGate) {
		t.Fatalf("hired via TransitionStage: %v", err)
	}
	for _, to := range []string{stage.ToAssess, stage.ToInterview, stage.Shoot, stage.QM, stage.ToHire} {
		if _, err := f.TransitionStage(ctx, app.AriaID, to); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.MarkHired(ctx, app.AriaID, hiregate.Clearance{}); err == nil {
		t.Fatal("hired without a clearance")
	}
	live, _ := f.ReadApplicant(ctx, app.AriaID)
	if live.Stage != stage.ToHire {
		t.Fatalf("stage = %s", live.Stage)
	}
}

func TestConcurrentUpsert(t *testing.T) {
	ctx := context.Background()
	f, _ := newFake(t, "19")
	mustJob(t, f)
	in := applicantInput()
	var wg sync.WaitGroup
	errCh := make(chan error, 32)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := f.UpsertApplicant(ctx, in); err != nil {
				errCh <- err
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}
	if f.Counts().Applicants != 1 {
		t.Fatalf("applicants = %d", f.Counts().Applicants)
	}
}
