package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMutatingRoutesRequireToken(t *testing.T) {
	srv, _ := newServer(t)
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]any{
		"aria_id": "job-1", "idempotency_key": "job-1", "name": "Synthetic role", "openings": 1,
	})
	req := httptest.NewRequest(http.MethodPost, "/campaigns", &buf)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated create = %d", rec.Code)
	}
	health := httptest.NewRecorder()
	srv.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health = %d", health.Code)
	}
}

func TestOptOutAndEraseCloseOutreach(t *testing.T) {
	srv, _ := newServer(t)
	created := post(t, srv, "/campaigns", map[string]any{
		"aria_id": "job-1", "idempotency_key": "job-1", "name": "Synthetic role",
		"smart_need_id": "need-1001", "openings": 1,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("campaign %d %s", created.Code, created.Body)
	}
	cand := post(t, srv, "/candidates", map[string]any{
		"aria_id": "cand-1", "idempotency_key": "cand-1", "name": "Mina Ortega",
		"email": "mina.ortega@people.example.test", "job_aria_id": "job-1",
		"source": "Candidate-supplied", "smart_need_id": "need-1001", "smart_candidate_id": "cand-2002",
	})
	if cand.Code != http.StatusCreated {
		t.Fatalf("candidate %d %s", cand.Code, cand.Body)
	}
	opt := post(t, srv, "/candidates/cand-1/opt-out", map[string]any{})
	if opt.Code != http.StatusOK {
		t.Fatalf("opt-out %d %s", opt.Code, opt.Body)
	}
	touch := post(t, srv, "/candidates/cand-1/touches", map[string]string{
		"idempotency_key": "t1", "channel": "note", "kind": "message",
		"subject": "Hello", "body": "Synthetic note",
	})
	if touch.Code != http.StatusConflict {
		t.Fatalf("touch after opt-out = %d %s", touch.Code, touch.Body)
	}
	erase := post(t, srv, "/candidates/cand-9/erase", map[string]any{})
	if erase.Code != http.StatusNotFound {
		t.Fatalf("missing erase = %d", erase.Code)
	}
}
