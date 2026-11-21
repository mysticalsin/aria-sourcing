package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/app"
	"github.com/mysticalsin/aria-sourcing/services/internal/config"
)

func TestRunRequiresIdentityForApprovals(t *testing.T) {
	const token = "synthetic-token"
	const actor = "ada.example"
	err := app.Run(context.Background(), func(name string) (string, bool) {
		switch name {
		case config.EnvOdooURL:
			return "http://odoo.example.test", true
		case config.EnvOdooDB:
			return "synthetic", true
		case config.EnvOdooAPIKey:
			return "synthetic-key", true
		case config.EnvAriaMode:
			return "test", true
		case config.EnvOdooVersion:
			return "19", true
		case config.EnvRecipientAllowlist:
			return "mina.ortega@people.example.test", true
		case "ARIA_API_TOKEN":
			return token, true
		case "ARIA_API_ACTOR":
			return actor, true
		default:
			t.Fatalf("unexpected env %s", name)
			return "", false
		}
	}, nil, func(h http.Handler) error {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/approvals", strings.NewReader(`{}`)))
		if rec.Code != http.StatusUnauthorized {
			return errStatus("approvals", rec)
		}
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/candidates", nil))
		if rec.Code != http.StatusUnauthorized {
			return errStatus("candidates", rec)
		}
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
		if rec.Code != http.StatusOK {
			return errStatus("health", rec)
		}
		job := authedJSON(t, h, token, http.MethodPost, "/campaigns", map[string]any{
			"aria_id": "job-1", "idempotency_key": "job-1", "name": "Synthetic role",
			"client_name": "Northwind Example", "smart_need_id": "need-1001", "openings": 1,
		})
		if job.Code != http.StatusCreated {
			return errStatus("campaign", job)
		}
		cand := authedJSON(t, h, token, http.MethodPost, "/candidates", map[string]any{
			"aria_id": "cand-1", "idempotency_key": "cand-1", "name": "Mina Ortega",
			"email": "mina.ortega@people.example.test", "job_aria_id": "job-1",
			"source": "Candidate-supplied", "smart_need_id": "need-1001", "smart_candidate_id": "cand-2002",
		})
		if cand.Code != http.StatusCreated {
			return errStatus("candidate", cand)
		}
		approved := authedJSON(t, h, token, http.MethodPost, "/approvals", map[string]any{
			"channel": "email", "recipient_ref": "mina.ortega@people.example.test",
			"subject": "Hello", "body": "Synthetic exact text", "notice_version": "art14-2026-11",
			"approver": "other.person", "applicant_aria_id": "cand-1",
		})
		if approved.Code != http.StatusCreated ||
			!bytes.Contains(approved.Body.Bytes(), []byte(`"approver":"ada.example"`)) ||
			bytes.Contains(approved.Body.Bytes(), []byte("other.person")) {
			return errStatus("approver", approved)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func authedJSON(t *testing.T, h http.Handler, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

type statusError struct {
	what string
	code int
	body string
}

func (e statusError) Error() string {
	return e.what + " " + http.StatusText(e.code) + " " + e.body
}

func errStatus(what string, rec *httptest.ResponseRecorder) error {
	return statusError{what: what, code: rec.Code, body: rec.Body.String()}
}
