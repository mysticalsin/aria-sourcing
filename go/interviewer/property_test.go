package interviewer_test

import (
	"context"
	"encoding/hex"
	"errors"
	"math/rand"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/interviewer"
)

// Forge check: property tests. The state machine, the idempotency digest,
// the disabled flag, signature bit-flips, and advisory recommendations hold
// across the whole input space exercised here, not one happy-path sample.

func allStates() []interviewer.State {
	return []interviewer.State{
		interviewer.StateNotRequested,
		interviewer.StateRequested,
		interviewer.StateInProgress,
		interviewer.StateCompleted,
		interviewer.StateFailed,
		interviewer.StateExpired,
	}
}

func allStages() []interviewer.Stage {
	return []interviewer.Stage{
		interviewer.StageToRate,
		interviewer.StageToAssess,
		interviewer.StageToInterview,
		interviewer.StageShoot,
		interviewer.StageQM,
		interviewer.StageToHire,
		interviewer.StageHired,
		interviewer.StageRejected,
		interviewer.StageWithdrawn,
	}
}

func legalTransition(from, to interviewer.State) bool {
	if from == to {
		return true
	}
	switch from {
	case interviewer.StateNotRequested:
		return to == interviewer.StateRequested
	case interviewer.StateRequested:
		return to == interviewer.StateInProgress || to == interviewer.StateCompleted || to == interviewer.StateFailed || to == interviewer.StateExpired
	case interviewer.StateInProgress:
		return to == interviewer.StateCompleted || to == interviewer.StateFailed || to == interviewer.StateExpired
	default:
		return false
	}
}

func TestProperty_StateMachineIsClosed(t *testing.T) {
	states := allStates()
	if len(states) != 6 {
		t.Fatalf("state count %d", len(states))
	}
	seen := map[interviewer.State]bool{}
	for _, from := range states {
		if seen[from] {
			t.Fatalf("duplicate state %s", from)
		}
		seen[from] = true
		for _, to := range states {
			err := interviewer.Transition(from, to)
			want := legalTransition(from, to)
			if want && err != nil {
				t.Fatalf("legal %s -> %s: %v", from, to, err)
			}
			if !want && !errors.Is(err, interviewer.ErrTransition) {
				t.Fatalf("illegal %s -> %s err=%v", from, to, err)
			}
		}
	}
	if err := interviewer.Transition(interviewer.StateNotRequested, interviewer.StateCompleted); !errors.Is(err, interviewer.ErrTransition) {
		t.Fatalf("direct completion must be illegal, got %v", err)
	}
	if err := interviewer.Transition("Other", interviewer.StateRequested); !errors.Is(err, interviewer.ErrTransition) {
		t.Fatalf("unknown state err=%v", err)
	}
}

func TestProperty_IdempotencyKeyIsStableDigest(t *testing.T) {
	rng := rand.New(rand.NewSource(20261121))
	seen := map[string]string{}
	alphabet := []rune("abcdefghijklmnopqrstuvwxyz0123456789")
	randID := func() string {
		n := 1 + rng.Intn(12)
		b := make([]rune, n)
		for i := range b {
			b[i] = alphabet[rng.Intn(len(alphabet))]
		}
		return string(b)
	}
	for i := 0; i < 40; i++ {
		c, n, a := randID(), randID(), randID()
		k1 := interviewer.IdempotencyKey(c, n, a)
		k2 := interviewer.IdempotencyKey(c, n, a)
		if k1 != k2 || k1 == "" {
			t.Fatalf("unstable key %q %q", k1, k2)
		}
		if strings.Contains(k1, c) || strings.Contains(k1, n) || strings.Contains(k1, a) {
			t.Fatalf("digest leaked an input: %s", k1)
		}
		token := c + "\x00" + n + "\x00" + a
		if prev, ok := seen[k1]; ok && prev != token {
			t.Fatalf("collision %q", k1)
		}
		seen[k1] = token
	}
	if interviewer.IdempotencyKey("a", "bb", "c") == interviewer.IdempotencyKey("ab", "b", "c") {
		t.Fatal("length-prefix collision")
	}
	if interviewer.IdempotencyKey("a", "b", "c") == interviewer.IdempotencyKey("a", "b", "d") {
		t.Fatal("approval id ignored")
	}
}

func TestProperty_DisabledNeverCalls(t *testing.T) {
	calls := 0
	svc := interviewer.New(interviewer.Config{
		BaseURL:       "http:" + "//127.0.0.1",
		APIKey:        "test-interviewer-key",
		WebhookSecret: "test-webhook-secret",
		Enabled:       false,
	}, interviewer.WithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("disabled flag still called the interviewer")
	})))
	for _, stage := range allStages() {
		for _, approved := range []bool{true, false} {
			for _, consent := range []bool{true, false} {
				cand := validCandidate()
				cand.Stage = stage
				cand.HumanApprovalRecorded = approved
				cand.Consent = consent
				h, err := svc.RequestScreening(context.Background(), cand, validNeed())
				if !errors.Is(err, interviewer.ErrDisabled) {
					t.Fatalf("stage %s approved %v consent %v err %v", stage, approved, consent, err)
				}
				if h.State != interviewer.StateNotRequested {
					t.Fatalf("state %s", h.State)
				}
				assertAdvisory(t, h, stage)
			}
		}
	}
	if calls != 0 {
		t.Fatalf("calls %d", calls)
	}
}

func TestProperty_SignatureBitflipRejected(t *testing.T) {
	body := completedBody("scr-synthetic-1", "hire")
	secret := "test-webhook-secret"
	sig := signBody(secret, body)
	raw, err := hex.DecodeString(sig)
	if err != nil {
		t.Fatal(err)
	}
	if !interviewer.VerifySignature(secret, body, sig) {
		t.Fatal("valid signature rejected")
	}
	for i := 0; i < len(raw)*8; i++ {
		mut := append([]byte(nil), raw...)
		mut[i/8] ^= 1 << (uint(i) % 8)
		if interviewer.VerifySignature(secret, body, hex.EncodeToString(mut)) {
			t.Fatalf("bit %d still verified", i)
		}
	}
	if interviewer.VerifySignature(secret, append(body, ' '), sig) {
		t.Fatal("body mutation still verified")
	}
}

func TestProperty_RecommendationStaysAdvisory(t *testing.T) {
	recs := []string{"strong_hire", "hire", "lean_hire", "no_hire", "strong_no_hire"}
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	for _, rec := range recs {
		current := interviewer.Handoff{
			State:       interviewer.StateRequested,
			ScreeningID: "scr-synthetic-1",
			Stage:       interviewer.StageToInterview,
		}
		body := completedBody("scr-synthetic-1", rec)
		h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
		if err != nil {
			t.Fatalf("recommendation %s: %v", rec, err)
		}
		if h.State != interviewer.StateCompleted {
			t.Fatalf("state %s", h.State)
		}
		if h.Report == nil || !h.Report.Advisory || h.Report.Recommendation != rec {
			t.Fatalf("report %#v", h.Report)
		}
		assertAdvisory(t, h, interviewer.StageToInterview)
		if h.Stage == interviewer.StageRejected || h.Stage == interviewer.StageWithdrawn {
			t.Fatal("recommendation moved the candidate out of to_interview")
		}
	}
}

func TestProperty_RepeatCreateIsIdempotent(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	var first interviewer.Handoff
	for n := 1; n <= 5; n++ {
		h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
		if err != nil {
			t.Fatal(err)
		}
		if n == 1 {
			first = h
		}
		if h.ScreeningID != first.ScreeningID || h.IdempotencyKey != first.IdempotencyKey {
			t.Fatalf("call %d drifted: %+v vs %+v", n, h, first)
		}
		if h.State != interviewer.StateRequested {
			t.Fatalf("state %s", h.State)
		}
		assertAdvisory(t, h, interviewer.StageToInterview)
	}
	if fake.creates() != 1 {
		t.Fatalf("creates %d", fake.creates())
	}
	if fake.postHits() != 5 {
		t.Fatalf("posts %d", fake.postHits())
	}
}
