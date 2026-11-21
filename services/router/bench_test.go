package router

import (
	"context"
	"math"
	"testing"
)

// Benchmarks measure router overhead on fake providers. They are not model
// latency. Plan §16 targets for the real calls this router stands in front
// of: QC p50 0.6s / p95 1.5s, intake p50 1.2s / p95 3s, cached draft p50 2s
// / p95 5s. Rules and cache hits have to stay far under those.
func BenchmarkRulesTier(b *testing.B) {
	r := benchRouter(b, false)
	req := Request{ID: "b", Task: TaskStageLabel, Input: "to_assess"}
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := r.Route(ctx, req); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkCacheHit(b *testing.B) {
	r := benchRouter(b, true)
	req := Request{ID: "b", Task: TaskClassify, Input: "thanks", MaxTokens: 64}
	ctx := context.Background()
	if _, err := r.Route(ctx, req); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		res, err := r.Route(ctx, req)
		if err != nil {
			b.Fatal(err)
		}
		if !res.CacheHit {
			b.Fatal("expected cache hit")
		}
	}
}

func BenchmarkSmallTier(b *testing.B) {
	r := benchRouter(b, false)
	req := Request{ID: "b", Task: TaskExtract, Input: "knows Go", MaxTokens: 64}
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req.Input = "knows Go " + pad3(i%1000)
		if _, err := r.Route(ctx, req); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkEscalation(b *testing.B) {
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		return Completion{Text: "unsure", Confidence: 0.2, InputTokens: 20, OutputTokens: 8}, nil
	})
	big := NewFakeProvider(TierBig, func(context.Context, CompletionRequest) (Completion, error) {
		return Completion{Text: "draft", Confidence: 0.95, InputTokens: 40, OutputTokens: 20}, nil
	})
	cfg := benchConfig()
	cfg.CacheEnabled = false
	r, err := New(cfg, Deps{Small: small, Big: big})
	if err != nil {
		b.Fatal(err)
	}
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := Request{ID: "b", Task: TaskClassify, Input: "ambiguous " + pad3(i%1000), MaxTokens: 64}
		if _, err := r.Route(ctx, req); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkBudgetStop(b *testing.B) {
	r := benchRouter(b, false)
	r.SetTokenBudgets(0, 0, 0)
	req := Request{ID: "b", Task: TaskClassify, Input: "stop", MaxTokens: 32}
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := r.Route(ctx, req)
		if err != ErrBudgetExceeded {
			b.Fatalf("err %v", err)
		}
	}
}

func BenchmarkSyntheticCold(b *testing.B) {
	reqs := SyntheticWorkload()
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r := benchRouter(b, false)
		for _, req := range reqs {
			if _, err := r.Route(ctx, req); err != nil {
				b.Fatal(err)
			}
		}
	}
}

func BenchmarkSyntheticWarm(b *testing.B) {
	r := benchRouter(b, true)
	reqs := SyntheticWorkload()
	ctx := context.Background()
	for _, req := range reqs {
		if _, err := r.Route(ctx, req); err != nil {
			b.Fatal(err)
		}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, req := range reqs {
			res, err := r.Route(ctx, req)
			if err != nil {
				b.Fatal(err)
			}
			if !res.CacheHit {
				b.Fatal("expected cache hit")
			}
		}
	}
}

func benchConfig() Config {
	cfg := DefaultConfig()
	cfg.RunTokenBudget = math.MaxInt64 / 4
	cfg.DailyTokenBudget = math.MaxInt64 / 4
	cfg.MonthlyTokenBudget = math.MaxInt64 / 4
	cfg.DailyBudgetUSD = 1e12
	cfg.MonthlyBudgetUSD = 1e12
	return cfg
}

func benchRouter(b *testing.B, cache bool) *Router {
	b.Helper()
	cfg := benchConfig()
	cfg.CacheEnabled = cache
	r, err := New(cfg, Deps{})
	if err != nil {
		b.Fatal(err)
	}
	return r
}
