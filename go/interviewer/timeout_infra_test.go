package interviewer_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/go/interviewer"
)

// Forge check: a timeout is an infrastructure error after exactly one retry.
// It does not fail the candidate, change the Odoo stage, or count as validation.

func TestTimeoutCountsAsInfraErrorAfterOneRetry(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	fake.hangPOST = true
	cfg := enabledConfig(fake.url())
	cfg.HTTPTimeout = 200 * time.Millisecond
	svc := interviewer.New(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	h, err := svc.RequestScreening(ctx, validCandidate(), validNeed())
	if !errors.Is(err, interviewer.ErrInfra) {
		t.Fatalf("err %v", err)
	}
	if errors.Is(err, interviewer.ErrValidation) || errors.Is(err, interviewer.ErrRemote) {
		t.Fatalf("timeout classified as %v", err)
	}
	if fake.postHits() != 2 {
		t.Fatalf("post attempts %d, want 2", fake.postHits())
	}
	if h.State != interviewer.StateNotRequested {
		t.Fatalf("state %s", h.State)
	}
	if h.ScreeningID != "" {
		t.Fatalf("screening id recorded on timeout: %s", h.ScreeningID)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func TestTimeoutCountsAsInfraErrorAfterOneRetryOnPoll(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	cfg := enabledConfig(fake.url())
	cfg.HTTPTimeout = 200 * time.Millisecond
	svc := interviewer.New(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	h, err := svc.RequestScreening(ctx, validCandidate(), validNeed())
	if err != nil {
		t.Fatal(err)
	}
	if h.State != interviewer.StateRequested {
		t.Fatalf("state %s", h.State)
	}
	fake.hangGET = true
	polled, err := svc.Poll(ctx, h)
	if !errors.Is(err, interviewer.ErrInfra) {
		t.Fatalf("err %v", err)
	}
	if errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("poll timeout classified as validation")
	}
	if fake.getHits() != 2 {
		t.Fatalf("get attempts %d, want 2", fake.getHits())
	}
	if polled.State != interviewer.StateRequested || polled.ScreeningID != h.ScreeningID {
		t.Fatalf("poll timeout mutated handoff: %+v", polled)
	}
	assertAdvisory(t, polled, interviewer.StageToInterview)
}
