package ledger_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/ledger"
)

func TestSharedApprovalVectors(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "..", "docs", "approval-hash-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Vectors []struct {
			Channel       string `json:"channel"`
			RecipientRef  string `json:"recipient_ref"`
			Subject       string `json:"subject"`
			Body          string `json:"body"`
			NoticeVersion string `json:"notice_version"`
			ApplicantID   string `json:"applicant_id"`
			Digest        string `json:"digest"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Vectors) < 2 {
		t.Fatal("missing vectors")
	}
	for _, vector := range doc.Vectors {
		got := ledger.Hash(vector.Channel, vector.RecipientRef, vector.Subject, vector.Body, vector.NoticeVersion, vector.ApplicantID)
		if got != vector.Digest {
			t.Fatalf("%s digest %s, want %s", vector.ApplicantID, got, vector.Digest)
		}
	}
}

func TestApprovalDigestBindsApplicant(t *testing.T) {
	led := ledger.New(func() time.Time { return time.Date(2026, 11, 21, 0, 0, 0, 0, time.UTC) })
	base := ledger.Request{
		Channel: "email", RecipientRef: "ada@example.test", Subject: "Hello Ada",
		Body: "Exact body", NoticeVersion: "art14-lgpd-2026-11", Approver: "ria.nunes",
		ApplicantAriaID: "cand-1",
	}
	first, err := led.Approve(base)
	if err != nil {
		t.Fatal(err)
	}
	other := base
	other.ApplicantAriaID = "cand-2"
	second, err := led.Approve(other)
	if err != nil {
		t.Fatal(err)
	}
	if first.Hash == second.Hash || len(led.List()) != 2 {
		t.Fatalf("cand-2 reused cand-1 grant hash=%s list=%d", first.Hash, len(led.List()))
	}
}
