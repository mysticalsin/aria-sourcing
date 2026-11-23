package odoo_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
)

func (m *memRPC) XMLResID(name, model string) (int64, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, row := range m.rows["ir.model.data"] {
		if row["name"] == name && row["model"] == model {
			id, err := strconv.ParseInt(row["res_id"], 10, 64)
			if err != nil {
				return 0, false
			}
			return id, true
		}
	}
	return 0, false
}

// failNamedBind fails the first ir.model.data create whose payload contains namePrefix.
type failNamedBind struct {
	base       *memRPC
	namePrefix string
	mu         sync.Mutex
	used       bool
}

func (f *failNamedBind) RoundTrip(req *http.Request) (*http.Response, error) {
	if strings.Contains(req.URL.Path, "/ir.model.data/create") {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		req.Body = io.NopCloser(bytes.NewReader(body))
		if strings.Contains(string(body), f.namePrefix) {
			f.mu.Lock()
			first := !f.used
			f.used = true
			f.mu.Unlock()
			if first {
				return jsonResponse(500, map[string]string{"message": "bind failed"}), nil
			}
		}
	}
	return f.base.RoundTrip(req)
}

func TestSecondClientPersonReplayDoesNotDuplicate(t *testing.T) {
	ctx := context.Background()
	rpc := newMemRPC()
	person := odoo.Person{
		AriaID: "person-1", IdempotencyKey: "person-1",
		Name: "Mina Ortega", Email: "mina.ortega@people.example.test",
	}
	first, err := testClient(t, "19", "", rpc).UpsertPerson(ctx, person)
	if err != nil {
		t.Fatal(err)
	}
	second, err := testClient(t, "19", "", rpc).UpsertPerson(ctx, person)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == 0 || second.ID != first.ID {
		t.Fatalf("replay id = %d, first = %d", second.ID, first.ID)
	}
	resID, ok := rpc.XMLResID("person_person-1", "hr.applicant")
	if !ok || resID != first.ID {
		t.Fatalf("xml res_id = %d ok=%v want %d", resID, ok, first.ID)
	}
	if rpc.CreateCount("hr.applicant") != 1 || rpc.Live("hr.applicant") != 1 || rpc.CreateCount("res.partner") != 1 {
		t.Fatalf("applicant creates=%d live=%d partner creates=%d", rpc.CreateCount("hr.applicant"), rpc.Live("hr.applicant"), rpc.CreateCount("res.partner"))
	}
}

func TestFailedApplicantBindIsUnlinked(t *testing.T) {
	ctx := context.Background()
	rpc := newMemRPC()
	if _, err := testClient(t, "19", "", rpc).UpsertJob(ctx, odoo.Job{
		AriaID: "job-1", IdempotencyKey: "job-1", Name: "Synthetic role",
	}); err != nil {
		t.Fatal(err)
	}
	in := applicantInput()
	gate := &failNamedBind{base: rpc, namePrefix: `"name":"applicant_`}
	if _, err := testClient(t, "19", "", gate).UpsertApplicant(ctx, in); err == nil {
		t.Fatal("applicant external-id bind should fail once")
	}
	if rpc.Live("hr.applicant") != 0 {
		t.Fatalf("failed bind left an applicant: live=%d creates=%d", rpc.Live("hr.applicant"), rpc.CreateCount("hr.applicant"))
	}
	got, err := testClient(t, "19", "", rpc).UpsertApplicant(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	resID, ok := rpc.XMLResID("applicant_"+in.AriaID, "hr.applicant")
	if !ok || resID != got.ID || rpc.Live("hr.applicant") != 1 {
		t.Fatalf("retry id=%d xml=%d ok=%v live=%d", got.ID, resID, ok, rpc.Live("hr.applicant"))
	}
}

func TestSecondClientJobReplayDoesNotCreateAnotherCampaign(t *testing.T) {
	ctx := context.Background()
	rpc := newMemRPC()
	job := odoo.Job{AriaID: "job-1", IdempotencyKey: "job-1", Name: "Synthetic role", Openings: 1}
	first, err := testClient(t, "19", "", rpc).UpsertJob(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	second, err := testClient(t, "19", "", rpc).UpsertJob(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == 0 || second.ID != first.ID {
		t.Fatalf("replay id = %d, first = %d", second.ID, first.ID)
	}
	if rpc.CreateCount("hr.job") != 1 || rpc.CreateCount("utm.campaign") != 1 || rpc.Live("utm.campaign") != 1 {
		t.Fatalf("job creates=%d campaign creates=%d live=%d", rpc.CreateCount("hr.job"), rpc.CreateCount("utm.campaign"), rpc.Live("utm.campaign"))
	}
}
