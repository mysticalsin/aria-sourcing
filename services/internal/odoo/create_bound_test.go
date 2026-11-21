package odoo_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
)

type failOnceBind struct {
	base *memRPC
	mu   sync.Mutex
	used bool
}

func (f *failOnceBind) RoundTrip(req *http.Request) (*http.Response, error) {
	if strings.Contains(req.URL.Path, "/ir.model.data/create") {
		f.mu.Lock()
		first := !f.used
		f.used = true
		f.mu.Unlock()
		if first {
			io.Copy(io.Discard, req.Body)
			return jsonResponse(500, map[string]string{"message": "bind failed"}), nil
		}
	}
	return f.base.RoundTrip(req)
}

func (m *memRPC) Live(model string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.rows[model])
}

func TestCreateThenFailedBindDoesNotDuplicateJobOrPartnerOrLead(t *testing.T) {
	ctx := context.Background()
	rpc := newMemRPC()
	c := testClient(t, "19", "", &failOnceBind{base: rpc})
	job := odoo.Job{AriaID: "job-1", IdempotencyKey: "job-1", Name: "Synthetic role", Openings: 1}
	if _, err := c.UpsertJob(ctx, job); err == nil {
		t.Fatal("first bind should fail")
	}
	c2 := testClient(t, "19", "", rpc)
	if _, err := c2.UpsertJob(ctx, job); err != nil {
		t.Fatal(err)
	}
	if rpc.Live("hr.job") != 1 {
		t.Fatalf("live jobs = %d", rpc.Live("hr.job"))
	}
	partner := odoo.Partner{AriaID: "co-1", IdempotencyKey: "co-1", Name: "Northwind Example", IsCompany: true}
	if _, err := c2.UpsertPartner(ctx, partner); err != nil {
		t.Fatal(err)
	}
	if _, err := testClient(t, "19", "", rpc).UpsertPartner(ctx, partner); err != nil {
		t.Fatal(err)
	}
	if rpc.CreateCount("res.partner") != 1 {
		t.Fatalf("partners created = %d", rpc.CreateCount("res.partner"))
	}
	lead := odoo.Lead{AriaID: "lead-1", IdempotencyKey: "lead-1", Name: "Synthetic role", PartnerAriaID: "co-1", Type: "opportunity"}
	if _, err := c2.UpsertLead(ctx, lead); err != nil {
		t.Fatal(err)
	}
	if _, err := testClient(t, "19", "", rpc).UpsertLead(ctx, lead); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range rpc.rows["ir.model.data"] {
		if row["name"] == "lead_lead-1" && row["model"] == "crm.lead" {
			found = true
		}
	}
	if !found || rpc.CreateCount("crm.lead") != 1 {
		t.Fatalf("lead xmlid=%v creates=%d", found, rpc.CreateCount("crm.lead"))
	}
}
