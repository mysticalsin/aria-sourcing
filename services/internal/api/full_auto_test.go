package api_test

import (
	"bytes"
	"net/http"
	"testing"
)

func TestFullAutoOptInAndKillSwitch(t *testing.T) {
	srv, _ := newServer(t)
	created := post(t, srv, "/campaigns", map[string]any{
		"aria_id": "job-1", "idempotency_key": "job-1", "name": "Plastic design synthetic",
		"client_name": "Northwind Example", "openings": 1,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("campaign %d %s", created.Code, created.Body)
	}
	cand := post(t, srv, "/candidates", map[string]any{
		"aria_id": "cand-1", "idempotency_key": "cand-1", "name": "Mina Ortega",
		"email": "mina.ortega@people.example.test", "job_aria_id": "job-1", "source": "Candidate-supplied",
	})
	if cand.Code != http.StatusCreated {
		t.Fatalf("candidate %d %s", cand.Code, cand.Body)
	}
	body := "Ada, the example ledger you published in 2024 is the piece I want to talk about, including the hash binding and the audit trail you kept."
	touch := map[string]string{
		"idempotency_key": "mail-1", "channel": "email", "kind": "message",
		"subject": "Hello", "body": body, "recipient_ref": "mina.ortega@people.example.test",
		"notice_version": "art14-lgpd-2026-11",
	}
	denied := post(t, srv, "/candidates/cand-1/touches", touch)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("default send %d %s", denied.Code, denied.Body)
	}
	opt := post(t, srv, "/campaigns/job-1/full-auto", map[string]string{"channel": "email"})
	if opt.Code != http.StatusCreated {
		t.Fatalf("opt-in %d %s", opt.Code, opt.Body)
	}
	linked := post(t, srv, "/campaigns/job-1/full-auto", map[string]string{"channel": "LinkedIn"})
	if linked.Code != http.StatusBadRequest {
		t.Fatalf("linkedin opt-in %d %s", linked.Code, linked.Body)
	}
	qc := post(t, srv, "/qc", map[string]string{
		"channel": "email", "recipient_ref": "mina.ortega@people.example.test",
		"subject": "Hello", "body": body, "notice_version": "art14-lgpd-2026-11",
		"actor": "qc-stub", "applicant_aria_id": "cand-1",
	})
	if qc.Code != http.StatusCreated || !bytes.Contains(qc.Body.Bytes(), []byte(`"grants_approval":false`)) {
		t.Fatalf("qc %d %s", qc.Code, qc.Body)
	}
	sent := post(t, srv, "/candidates/cand-1/touches", touch)
	if sent.Code != http.StatusCreated {
		t.Fatalf("auto send %d %s", sent.Code, sent.Body)
	}
	stopped := post(t, srv, "/kill-switch", map[string]bool{"engaged": true})
	if stopped.Code != http.StatusOK || !bytes.Contains(stopped.Body.Bytes(), []byte(`"engaged":true`)) {
		t.Fatalf("kill switch %d %s", stopped.Code, stopped.Body)
	}
	touch["idempotency_key"] = "mail-2"
	blocked := post(t, srv, "/candidates/cand-1/touches", touch)
	if blocked.Code != http.StatusForbidden || !bytes.Contains(blocked.Body.Bytes(), []byte("kill_switch")) {
		t.Fatalf("blocked %d %s", blocked.Code, blocked.Body)
	}
}
