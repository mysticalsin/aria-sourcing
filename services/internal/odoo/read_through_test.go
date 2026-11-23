package odoo_test

import (
	"context"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/outbox"
)

func TestNewClientReadsExistingOdooRows(t *testing.T) {
	ctx := context.Background()
	rpc := newMemRPC()
	writer := testClient(t, "19", "", rpc)
	if _, err := writer.UpsertJob(ctx, odoo.Job{AriaID: "job-1", IdempotencyKey: "job-1", Name: "Synthetic role", Openings: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.UpsertApplicant(ctx, applicantInput()); err != nil {
		t.Fatal(err)
	}
	reader := testClient(t, "19", "", rpc)
	job, err := reader.ReadJob(ctx, "job-1")
	if err != nil || job.Name != "Synthetic role" || job.ID == 0 {
		t.Fatalf("job = %+v %v", job, err)
	}
	app, err := reader.ReadApplicant(ctx, "cand-1")
	if err != nil || app.PartnerName == "" || app.ID == 0 {
		t.Fatalf("applicant = %+v %v", app, err)
	}
	jobs, err := reader.ListJobs(ctx)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("jobs = %+v %v", jobs, err)
	}
	apps, err := reader.ListApplicants(ctx)
	if err != nil || len(apps) != 1 {
		t.Fatalf("applicants = %+v %v", apps, err)
	}
	if _, err := writer.OptOut(ctx, "cand-1"); err != nil {
		t.Fatal(err)
	}
	again, err := testClient(t, "19", "", rpc).ReadApplicant(ctx, "cand-1")
	if err != nil || !again.OptedOut {
		t.Fatalf("opt-out did not survive a new client: %+v %v", again, err)
	}
}

func TestOutboxIsBounded(t *testing.T) {
	box := outbox.New()
	for i := 0; i < outbox.MaxEntries+10; i++ {
		if err := box.Store("k"+itoa(i), i); err != nil {
			t.Fatal(err)
		}
	}
	if box.Len() > outbox.MaxEntries {
		t.Fatalf("len = %d, max = %d", box.Len(), outbox.MaxEntries)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
