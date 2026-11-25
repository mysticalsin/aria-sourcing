package router

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
)

func TestGap_CallerCancelIsNotASuccessfulFallback(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var calls atomic.Int32
	small := NewFakeProvider(TierSmall, func(ctx context.Context, _ CompletionRequest) (Completion, error) {
		calls.Add(1)
		cancel()
		return Completion{}, ctx.Err()
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{
		Small: small,
		Big:   scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1}),
	})
	res, err := r.Route(ctx, Request{ID: "cancel", Task: TaskClassify, Input: "classify this", MaxTokens: 16})
	if calls.Load() != 1 {
		t.Fatalf("provider calls %d", calls.Load())
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v text %q", err, res.Text)
	}
	if res.Text != "" {
		t.Fatalf("cancelled route produced %q", res.Text)
	}
	if r.Usage().RunTokens != 0 || r.CacheLen() != 0 {
		t.Fatalf("cancel spent or cached: usage=%+v cache=%d", r.Usage(), r.CacheLen())
	}
}

func TestGap_PanicReleasesTheReservation(t *testing.T) {
	var calls atomic.Int32
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		if calls.Add(1) == 1 {
			panic("provider blew up")
		}
		return Completion{Text: "ok", Confidence: 0.95, InputTokens: 1, OutputTokens: 1}, nil
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{
		Small: small,
		Big:   scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1}),
	})
	req := Request{ID: "panic", Task: TaskClassify, Input: "panic path", MaxTokens: 16}
	est, _ := r.Estimate(req, TierSmall)
	r.SetTokenBudgets(est, est, est)
	r.SetUSDBudgets(100, 100)

	var recovered any
	func() {
		defer func() { recovered = recover() }()
		_, _ = r.Route(context.Background(), req)
	}()
	if !errors.Is(asError(recovered), ErrInfra) {
		t.Fatalf("repanic %v", recovered)
	}

	res, err := r.Route(context.Background(), req)
	if err != nil {
		t.Fatalf("second route after panic: %v (reservation leaked)", err)
	}
	if res.Text != "ok" || res.Tier != TierSmall {
		t.Fatalf("tier %s text %q", res.Tier, res.Text)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls %d", calls.Load())
	}
}

func asError(value any) error {
	err, _ := value.(error)
	return err
}
