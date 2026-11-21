package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/api"
	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/ledger"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/recruit"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func fixedNow() time.Time { return time.Date(2026, 11, 20, 15, 4, 5, 0, time.UTC) }

func newServer(t *testing.T) (*api.Server, *dna.Fake) {
	t.Helper()
	log := audit.New(fixedNow)
	fake, err := odoo.NewFake("19", log, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	d := dna.NewFake()
	svc := recruit.New(fake, d, ledger.New(fixedNow), log, []string{"mina.ortega@people.example.test"}, fixedNow)
	srv := api.New(svc, "test", "19")
	srv.UseIdentity("synthetic-token", "ria.nunes")
	return srv, d
}

func post(t *testing.T, h http.Handler, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer synthetic-token")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHealthCampaignCandidateApprovalAndHire(t *testing.T) {
	srv, d := newServer(t)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != 200 || !bytes.Contains(rec.Body.Bytes(), []byte(`"backend":"fake"`)) || bytes.Contains(rec.Body.Bytes(), []byte("ODOO_")) {
		t.Fatalf("health %d %s", rec.Code, rec.Body)
	}
	for _, path := range []string{"/smart", "/arp", "/linkedin", "/odoo/approve"} {
		rec = httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer synthetic-token")
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s -> %d", path, rec.Code)
		}
	}
	created := post(t, srv, "/campaigns", map[string]any{
		"aria_id": "job-1", "idempotency_key": "job-1", "name": "Plastic design synthetic",
		"client_name": "Northwind Example", "smart_need_id": "need-1001", "openings": 1,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("campaign %d %s", created.Code, created.Body)
	}
	cand := post(t, srv, "/candidates", map[string]any{
		"aria_id": "cand-1", "idempotency_key": "cand-1", "name": "Mina Ortega",
		"email": "owner@example.com", "job_aria_id": "job-1", "source": "Candidate-supplied",
	})
	if cand.Code != http.StatusBadRequest {
		t.Fatalf("real email accepted: %d %s", cand.Code, cand.Body)
	}
	cand = post(t, srv, "/candidates", map[string]any{
		"aria_id": "cand-1", "idempotency_key": "cand-1", "name": "Mina Ortega",
		"email": "mina.ortega@people.example.test", "job_aria_id": "job-1",
		"source": "Candidate-supplied", "smart_need_id": "need-1001", "smart_candidate_id": "cand-2002",
	})
	if cand.Code != http.StatusCreated || !bytes.Contains(cand.Body.Bytes(), []byte(`"stage":"to_rate"`)) {
		t.Fatalf("candidate %d %s", cand.Code, cand.Body)
	}
	for _, to := range []string{stage.ToAssess, stage.ToInterview, stage.Shoot, stage.QM, stage.ToHire} {
		moved := post(t, srv, "/candidates/cand-1/transition", map[string]string{"to": to})
		if moved.Code != http.StatusOK {
			t.Fatalf("to %s: %d %s", to, moved.Code, moved.Body)
		}
	}
	smuggle := post(t, srv, "/candidates/cand-1/transition", map[string]any{"to": "hired", "dna_integrated": true})
	if smuggle.Code != http.StatusBadRequest {
		t.Fatalf("smuggled dna flag: %d %s", smuggle.Code, smuggle.Body)
	}
	refused := post(t, srv, "/candidates/cand-1/transition", map[string]string{"to": "hired"})
	if refused.Code != http.StatusConflict || !bytes.Contains(refused.Body.Bytes(), []byte("hired_refused")) {
		t.Fatalf("hire %d %s", refused.Code, refused.Body)
	}
	attached := post(t, srv, "/candidates/cand-1/contract", map[string]string{
		"filename": "contract-mina.pdf",
		"sha256":   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})
	if attached.Code != http.StatusOK || !bytes.Contains(attached.Body.Bytes(), []byte(`"contract_attached":true`)) {
		t.Fatalf("contract %d %s", attached.Code, attached.Body)
	}
	still := post(t, srv, "/candidates/cand-1/transition", map[string]string{"to": "hired"})
	if still.Code != http.StatusConflict {
		t.Fatalf("dna still required: %d %s", still.Code, still.Body)
	}
	d.Seed("cand-2002", "need-1001", true)
	hired := post(t, srv, "/candidates/cand-1/transition", map[string]string{"to": "hired"})
	if hired.Code != http.StatusOK || !bytes.Contains(hired.Body.Bytes(), []byte(`"stage":"hired"`)) {
		t.Fatalf("hired %d %s", hired.Code, hired.Body)
	}
	touch := post(t, srv, "/candidates/cand-1/touches", map[string]string{
		"idempotency_key": "touch-1", "channel": "email", "kind": "message",
		"subject": "Hello", "body": "Synthetic outreach body",
	})
	if touch.Code != http.StatusCreated {
		t.Fatalf("touch %d %s", touch.Code, touch.Body)
	}
	replay := post(t, srv, "/candidates/cand-1/touches", map[string]string{
		"idempotency_key": "touch-1", "channel": "email", "kind": "message",
		"subject": "Hello", "body": "Synthetic outreach body",
	})
	if replay.Code != http.StatusCreated || replay.Body.String() != touch.Body.String() {
		t.Fatalf("replay %s vs %s", replay.Body, touch.Body)
	}
	denied := post(t, srv, "/approvals", map[string]string{
		"channel": "email", "recipient_ref": "other.person@people.example.test",
		"subject": "Hello", "body": "Synthetic exact text", "notice_version": "art14-2026-11",
		"approver": "ria.nunes", "applicant_aria_id": "cand-1",
	})
	if denied.Code != http.StatusForbidden {
		t.Fatalf("allowlist %d %s", denied.Code, denied.Body)
	}
	ok := post(t, srv, "/approvals", map[string]string{
		"channel": "email", "recipient_ref": "mina.ortega@people.example.test",
		"subject": "Hello", "body": "Synthetic exact text", "notice_version": "art14-2026-11",
		"approver": "ria.nunes", "applicant_aria_id": "cand-1",
	})
	if ok.Code != http.StatusCreated || !bytes.Contains(ok.Body.Bytes(), []byte(`"granted_by":"aria-ledger"`)) {
		t.Fatalf("approval %d %s", ok.Code, ok.Body)
	}
	fromOdoo := post(t, srv, "/approvals/from-odoo", map[string]string{"note": ok.Body.String()})
	if fromOdoo.Code != http.StatusForbidden || !bytes.Contains(fromOdoo.Body.Bytes(), []byte("odoo_cannot_grant_approval")) {
		t.Fatalf("from odoo %d %s", fromOdoo.Code, fromOdoo.Body)
	}
}
