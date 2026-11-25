package interviewer_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/interviewer"
)

func TestHandoff_PostThenPollMapsReport(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	capture := interviewer.New(enabledConfig(fake.url()))

	h, err := capture.RequestScreening(context.Background(), validCandidate(), validNeed())
	if err != nil {
		t.Fatal(err)
	}
	if h.State != interviewer.StateRequested || h.ScreeningID == "" {
		t.Fatalf("handoff %+v", h)
	}
	if h.IdempotencyKey != interviewer.IdempotencyKey("cand-synthetic-001", "need-synthetic-001", "apr-synthetic-001") {
		t.Fatalf("key %s", h.IdempotencyKey)
	}
	posted, seen := fake.lastPost()
	if seen.Get("Authorization") != "Bearer test-interviewer-key" {
		t.Fatalf("auth %q", seen.Get("Authorization"))
	}
	if seen.Get(interviewer.IdempotencyHeader) != h.IdempotencyKey {
		t.Fatalf("idempotency header %q", seen.Get(interviewer.IdempotencyHeader))
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(posted, &raw); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{
		"need_summary": true, "role_questions": true, "candidate_id": true, "language": true, "consent": true,
	}
	if len(raw) != len(allowed) {
		t.Fatalf("fields %d", len(raw))
	}
	for k := range raw {
		if !allowed[k] {
			t.Fatalf("unexpected field %s", k)
		}
	}
	var payload struct {
		NeedSummary   string   `json:"need_summary"`
		RoleQuestions []string `json:"role_questions"`
		CandidateID   string   `json:"candidate_id"`
		Language      string   `json:"language"`
		Consent       bool     `json:"consent"`
	}
	if err := json.Unmarshal(posted, &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Consent || payload.CandidateID != "cand-synthetic-001" || payload.Language != "en" {
		t.Fatalf("payload %+v", payload)
	}
	if len(payload.RoleQuestions) != 2 || payload.RoleQuestions[0] != validNeed().RoleQuestions[0] {
		t.Fatalf("questions %#v", payload.RoleQuestions)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)

	fake.setStatus(h.ScreeningID, "active", nil)
	mid, err := capture.Poll(context.Background(), h)
	if err != nil {
		t.Fatal(err)
	}
	if mid.State != interviewer.StateInProgress || mid.Report != nil {
		t.Fatalf("mid %+v", mid)
	}

	fake.setStatus(h.ScreeningID, "completed", map[string]any{
		"scores": map[string]any{
			"Content":       map[string]any{"score": 4, "reasoning": "synthetic depth"},
			"Communication": map[string]any{"score": 3, "reasoning": "synthetic clarity"},
		},
		"overall":        3.5,
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "hire",
		"verdict":        "Qualify",
		"summary":        "Synthetic screening summary.",
	})
	done, err := capture.Poll(context.Background(), mid)
	if err != nil {
		t.Fatal(err)
	}
	if done.State != interviewer.StateCompleted || done.Report == nil {
		t.Fatalf("done %+v", done)
	}
	if !done.Report.Advisory || done.Report.Recommendation != "hire" || done.Report.TranscriptRef != "interviews/iv-synthetic-001" {
		t.Fatalf("report %#v", done.Report)
	}
	content, ok := scoreNamed(done.Report, "Content")
	if !ok || content.Value != 4 || content.Reasoning != "synthetic depth" {
		t.Fatalf("content %#v", content)
	}
	assertAdvisory(t, done, interviewer.StageToInterview)
}

func TestHandoff_SynchronousCompletionChainsLegalStates(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	fake.createStatus = "completed"
	fake.createExtra = map[string]any{
		"scores":         map[string]any{"Content": map[string]any{"score": 4, "reasoning": "synthetic"}},
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "lean_hire",
		"verdict":        "Borderline",
		"summary":        "Synthetic.",
	}
	svc := interviewer.New(enabledConfig(fake.url()))
	h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if err != nil {
		t.Fatal(err)
	}
	if h.State != interviewer.StateCompleted || h.Report == nil || h.Report.Recommendation != "lean_hire" || !h.Report.Advisory {
		t.Fatalf("handoff %+v report %#v", h, h.Report)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func TestHandoff_IdempotencyConflict(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	if _, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed()); err != nil {
		t.Fatal(err)
	}
	other := validNeed()
	other.Summary = "A different synthetic need with the same approval."
	// Same candidate and approval keep the key stable; the body differs.
	// Need ID is part of the key, so reuse the same need id.
	h, err := svc.RequestScreening(context.Background(), validCandidate(), other)
	if err == nil {
		t.Fatal("conflict treated as success")
	}
	if h.State == interviewer.StateRequested && h.ScreeningID != "" && fake.creates() != 1 {
		t.Fatalf("conflict created a second screening: %+v creates %d", h, fake.creates())
	}
	if fake.creates() != 1 {
		t.Fatalf("creates %d", fake.creates())
	}
}
