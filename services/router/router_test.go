package router

import (
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func Test_test_rules_tier_handles_deterministic_cases_without_model(t *testing.T) {
	cases := []struct {
		name string
		req  Request
		want string
	}{
		{
			name: "source allowlist",
			req:  Request{ID: "s1", Task: TaskSourceCheck, Input: "linkedin recruiter csv"},
			want: "source: LinkedIn Recruiter CSV",
		},
		{
			name: "source rejected",
			req:  Request{ID: "s2", Task: TaskSourceCheck, Input: "Apify"},
			want: "rejected: source not on the allowlist",
		},
		{
			name: "stage label",
			req:  Request{ID: "st", Task: TaskStageLabel, Input: "to interview"},
			want: "stage: To Interview",
		},
		{
			name: "score strong",
			req:  Request{ID: "sc1", Task: TaskScoreBand, Input: "82"},
			want: "score 82 band strong; suggestion only, no automated decision",
		},
		{
			name: "score weak",
			req:  Request{ID: "sc2", Task: TaskScoreBand, Input: "30"},
			want: "score 30 band weak; suggestion only, no automated decision",
		},
		{
			name: "score review",
			req:  Request{ID: "sc3", Task: TaskScoreBand, Fields: map[string]string{"score": "55"}},
			want: "score 55 band review; suggestion only, no automated decision",
		},
		{
			name: "notice",
			req: Request{
				ID:   "n1",
				Task: TaskNotice,
				Fields: map[string]string{
					"candidate_ref":  "cand-1",
					"source":         "RSC/ATS",
					"purpose":        "recruitment",
					"retention_days": "365",
					"notice_version": "2026-11-20",
				},
			},
			want: "Notice 2026-11-20: we process cand-1 from RSC/ATS for recruitment. Retention 365 days. You may object and request erasure. Opt out: unsubscribe@example.test",
		},
		{
			name: "notice incomplete",
			req:  Request{ID: "n2", Task: TaskNotice, Fields: map[string]string{"candidate_ref": "cand-1"}},
			want: "rejected: notice incomplete",
		},
		{
			name: "opt out",
			req:  Request{ID: "o1", Task: TaskOptOut, Input: "person@example.test"},
			want: "Opt-out recorded for person@example.test. No further messages. Confirmation only; nothing is sent automatically.",
		},
		{
			name: "suppression",
			req:  Request{ID: "p1", Task: TaskSuppression, Fields: map[string]string{"suppressed": "true"}},
			want: "Do not contact. Suppression is in force.",
		},
		{
			name: "qc pass",
			req:  Request{ID: "q1", Task: TaskQC, Input: "[notice] Hello cand-0001, your application is in review and we will write again."},
			want: "qc: pass",
		},
		{
			name: "qc banned phrase",
			req:  Request{ID: "q2", Task: TaskQC, Input: "[notice] Act now to guarantee an interview today, this is long enough."},
			want: "qc: fail; banned phrase",
		},
		{
			name: "empty classify",
			req:  Request{ID: "e1", Task: TaskClassify, Input: "  "},
			want: "rejected: empty input",
		},
		{
			name: "unknown task",
			req:  Request{ID: "u1", Task: Task("linkedin_scrape"), Input: "no"},
			want: "rejected: unknown task",
		},
		{
			name: "template draft",
			req: Request{
				ID:   "d1",
				Task: TaskDraft,
				Fields: map[string]string{
					"candidate_ref":  "cand-9",
					"role":           "Backend engineer",
					"skill":          "Go",
					"notice_version": "2026-11-20",
				},
			},
			want: "Hello cand-9, we are hiring a Backend engineer with Go. This is a suggestion a human must approve. Notice 2026-11-20. Opt out: unsubscribe@example.test",
		},
	}

	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		t.Errorf("small provider called")
		return Completion{}, errors.New("small provider called")
	})
	big := NewFakeProvider(TierBig, func(context.Context, CompletionRequest) (Completion, error) {
		t.Errorf("big provider called")
		return Completion{}, errors.New("big provider called")
	})
	r := mustRouter(t, DefaultConfig(), Deps{Small: small, Big: big})

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := r.Route(context.Background(), tc.req)
			if err != nil {
				t.Fatalf("route: %v", err)
			}
			if res.Text != tc.want {
				t.Fatalf("text %q", res.Text)
			}
			if res.Tier != TierRules {
				t.Fatalf("tier %s", res.Tier)
			}
			if res.InputTokens != 0 || res.OutputTokens != 0 || res.USD != 0 {
				t.Fatalf("rules spent tokens=%d/%d usd=%v", res.InputTokens, res.OutputTokens, res.USD)
			}
			if len(res.ProviderCalls) != 0 {
				t.Fatalf("provider calls %+v", res.ProviderCalls)
			}
			traceEqual(t, res.Trace, StateReceived, StateRuleHit, StateCached, StateDone)
		})
	}
	if small.Calls() != 0 || big.Calls() != 0 {
		t.Fatalf("providers called small=%d big=%d", small.Calls(), big.Calls())
	}
}

func Test_test_escalates_only_below_confidence_threshold(t *testing.T) {
	threshold := 0.80
	cases := []struct {
		name    string
		conf    float64
		text    string
		wantBig bool
	}{
		{name: "above", conf: 0.95, text: "label:positive", wantBig: false},
		{name: "at_threshold", conf: threshold, text: "label:positive", wantBig: false},
		{name: "just_below", conf: math.Nextafter(threshold, 0), text: "label:unsure", wantBig: true},
		{name: "low", conf: 0.10, text: "label:unsure", wantBig: true},
		{name: "nan_is_not_confident", conf: math.NaN(), text: "label:unsure", wantBig: true},
		{name: "empty_text_escalates", conf: 0.99, text: "  ", wantBig: true},
		{name: "above_one_escalates", conf: 1.2, text: "label:positive", wantBig: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			small := scripted(TierSmall, Completion{
				Text: tc.text, Confidence: tc.conf, InputTokens: 20, OutputTokens: 8,
			})
			big := scripted(TierBig, Completion{
				Text: "draft from big", Confidence: 0.97, InputTokens: 40, OutputTokens: 20,
			})
			cfg := DefaultConfig()
			cfg.ConfidenceThreshold = threshold
			r := mustRouter(t, cfg, Deps{Small: small, Big: big})
			res, err := r.Route(context.Background(), Request{
				ID: "c1", Task: TaskClassify, Input: "Thanks, happy to talk", MaxTokens: 64,
			})
			if err != nil {
				t.Fatalf("route: %v", err)
			}
			if tc.wantBig {
				if big.Calls() != 1 || small.Calls() != 1 {
					t.Fatalf("calls small=%d big=%d", small.Calls(), big.Calls())
				}
				if res.Tier != TierBig || res.Reason != ReasonConfidence {
					t.Fatalf("tier %s reason %s", res.Tier, res.Reason)
				}
				traceEqual(t, res.Trace,
					StateReceived, StateSmallModel, StateEscalated, StateBigModel, StateCached, StateDone)
			} else {
				if big.Calls() != 0 || small.Calls() != 1 {
					t.Fatalf("calls small=%d big=%d", small.Calls(), big.Calls())
				}
				if res.Tier != TierSmall || res.Reason != ReasonSmall {
					t.Fatalf("tier %s reason %s", res.Tier, res.Reason)
				}
				traceEqual(t, res.Trace, StateReceived, StateSmallModel, StateCached, StateDone)
			}
			if len(res.ProviderCalls) == 0 {
				t.Fatal("missing per-call metrics")
			}
			for _, call := range res.ProviderCalls {
				if call.InputTokens < 0 || call.OutputTokens < 0 || call.Latency < 0 {
					t.Fatalf("bad provider metric %+v", call)
				}
			}
		})
	}

	t.Run("complexity_shortlisted_draft_skips_small_provider", func(t *testing.T) {
		small := scripted(TierSmall, Completion{Text: "should not run", Confidence: 0.99, InputTokens: 10, OutputTokens: 4})
		big := scripted(TierBig, Completion{Text: "personal draft", Confidence: 0.96, InputTokens: 80, OutputTokens: 40})
		r := mustRouter(t, DefaultConfig(), Deps{Small: small, Big: big})
		res, err := r.Route(context.Background(), Request{
			ID: "draft", Task: TaskDraft, Shortlisted: true, Input: "shortlisted",
			Fields: map[string]string{
				"candidate_ref": "cand-1", "role": "Backend engineer", "skill": "Go", "notice_version": "2026-11-20",
			},
			MaxTokens: 200,
		})
		if err != nil {
			t.Fatal(err)
		}
		if small.Calls() != 0 {
			t.Fatalf("small provider spent tokens: calls=%d", small.Calls())
		}
		if big.Calls() != 1 || res.Tier != TierBig || res.Reason != ReasonComplexity {
			t.Fatalf("big=%d tier=%s reason=%s", big.Calls(), res.Tier, res.Reason)
		}
		traceEqual(t, res.Trace,
			StateReceived, StateSmallModel, StateEscalated, StateBigModel, StateCached, StateDone)
	})
}

func Test_test_cache_hit_skips_provider(t *testing.T) {
	calls := 0
	var firstLatency time.Duration
	small := NewFakeProvider(TierSmall, func(ctx context.Context, req CompletionRequest) (Completion, error) {
		calls++
		time.Sleep(15 * time.Millisecond)
		in, out := estimateTokens(req.System, req.Prompt, req.MaxTokens)
		return Completion{Text: "label:positive", Confidence: 0.91, InputTokens: int(in), OutputTokens: int(out)}, nil
	})
	big := NewFakeProvider(TierBig, func(context.Context, CompletionRequest) (Completion, error) {
		t.Errorf("big provider called")
		return Completion{}, errors.New("big called")
	})
	clk := &manualClock{t: time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)}
	cfg := DefaultConfig()
	cfg.CacheTTL = time.Hour
	r := mustRouter(t, cfg, Deps{Small: small, Big: big, Now: clk.Now})

	first := Request{ID: "a", Task: TaskClassify, Input: "same content", MaxTokens: 64}
	res1, err := r.Route(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	if res1.CacheHit || res1.Tier != TierSmall {
		t.Fatalf("first result cache=%v tier=%s", res1.CacheHit, res1.Tier)
	}
	if len(res1.ProviderCalls) != 1 || res1.ProviderCalls[0].Latency < 5*time.Millisecond {
		t.Fatalf("provider latency %+v", res1.ProviderCalls)
	}
	firstLatency = res1.Latency
	if res1.InputTokens <= 0 {
		t.Fatal("expected billed tokens on miss")
	}

	second := first
	second.ID = "b"
	res2, err := r.Route(context.Background(), second)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || small.Calls() != 1 || big.Calls() != 0 {
		t.Fatalf("provider calls fn=%d small=%d big=%d", calls, small.Calls(), big.Calls())
	}
	if !res2.CacheHit || res2.Tier != TierCache {
		t.Fatalf("second cache=%v tier=%s", res2.CacheHit, res2.Tier)
	}
	if res2.Text != res1.Text {
		t.Fatalf("cache returned %q", res2.Text)
	}
	if res2.InputTokens != 0 || res2.OutputTokens != 0 || len(res2.ProviderCalls) != 0 {
		t.Fatalf("cache hit spent %+v", res2)
	}
	traceEqual(t, res2.Trace, StateReceived, StateCached, StateDone)
	if res2.Latency < 0 || res2.Latency > firstLatency {
		t.Fatalf("cache latency %s first %s", res2.Latency, firstLatency)
	}

	t.Run("field_order_and_content", func(t *testing.T) {
		fresh := mustRouter(t, cfg, Deps{
			Small: scripted(TierSmall, Completion{Text: "n", Confidence: 0.9, InputTokens: 8, OutputTokens: 4}),
			Big:   scripted(TierBig, Completion{Text: "b", Confidence: 0.9, InputTokens: 8, OutputTokens: 4}),
			Now:   clk.Now,
		})
		a := Request{ID: "1", Task: TaskClassify, Input: "body", Fields: map[string]string{"b": "2", "a": "1"}, MaxTokens: 32}
		b := Request{ID: "2", Task: TaskClassify, Input: "body", Fields: map[string]string{"a": "1", "b": "2"}, MaxTokens: 32}
		if _, err := fresh.Route(context.Background(), a); err != nil {
			t.Fatal(err)
		}
		hit, err := fresh.Route(context.Background(), b)
		if err != nil {
			t.Fatal(err)
		}
		if !hit.CacheHit {
			t.Fatal("reordered fields missed the cache")
		}
		changed := b
		changed.ID = "3"
		changed.Fields = map[string]string{"a": "1", "b": "9"}
		miss, err := fresh.Route(context.Background(), changed)
		if err != nil {
			t.Fatal(err)
		}
		if miss.CacheHit {
			t.Fatal("different content hit the cache")
		}
	})

	t.Run("ttl_expiry_calls_provider_again", func(t *testing.T) {
		local := &manualClock{t: clk.Now()}
		small2 := scripted(TierSmall, Completion{Text: "label", Confidence: 0.9, InputTokens: 8, OutputTokens: 4})
		r2 := mustRouter(t, cfg, Deps{Small: small2, Big: scripted(TierBig, Completion{Text: "b", Confidence: 0.9, InputTokens: 4, OutputTokens: 2}), Now: local.Now})
		req := Request{ID: "t", Task: TaskClassify, Input: "expires", MaxTokens: 32}
		if _, err := r2.Route(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		local.Advance(time.Hour)
		again, err := r2.Route(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		if again.CacheHit || small2.Calls() != 2 {
			t.Fatalf("after ttl cache=%v calls=%d", again.CacheHit, small2.Calls())
		}
	})
}

func Test_test_budget_hard_stop(t *testing.T) {
	req := Request{ID: "b", Task: TaskClassify, Input: "please classify", MaxTokens: 64}

	t.Run("run_tokens", func(t *testing.T) {
		small := exactSmall()
		r := budgetRouter(t, small)
		est, _ := r.Estimate(req, TierSmall)
		r.SetTokenBudgets(est, math.MaxInt64/4, math.MaxInt64/4)
		if _, err := r.Route(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		res, err := r.Route(context.Background(), Request{ID: "b2", Task: TaskClassify, Input: "please classify more", MaxTokens: 64})
		if !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("err %v", err)
		}
		traceEqual(t, res.Trace, StateReceived, StateBudgetExceeded)
		if small.Calls() != 1 {
			t.Fatalf("calls %d", small.Calls())
		}
		if r.Usage().RunTokens != est {
			t.Fatalf("run usage %d", r.Usage().RunTokens)
		}
	})

	t.Run("daily_tokens", func(t *testing.T) {
		small := exactSmall()
		r := budgetRouter(t, small)
		est, _ := r.Estimate(req, TierSmall)
		r.SetTokenBudgets(math.MaxInt64/4, est, math.MaxInt64/4)
		if _, err := r.Route(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		r.BeginRun("run-2")
		_, err := r.Route(context.Background(), Request{ID: "d2", Task: TaskExtract, Input: "please extract more", MaxTokens: 64})
		if !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("err %v", err)
		}
		if small.Calls() != 1 {
			t.Fatalf("calls %d", small.Calls())
		}
	})

	t.Run("monthly_tokens_survive_a_new_day", func(t *testing.T) {
		clk := &manualClock{t: time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)}
		small := exactSmall()
		r := budgetRouterAt(t, small, clk)
		est, _ := r.Estimate(req, TierSmall)
		r.SetTokenBudgets(math.MaxInt64/4, math.MaxInt64/4, est)
		if _, err := r.Route(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		clk.Advance(24 * time.Hour)
		r.BeginRun("next-day")
		_, err := r.Route(context.Background(), Request{ID: "m2", Task: TaskIntake, Input: "please intake more", MaxTokens: 64})
		if !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("monthly stop: %v", err)
		}
		clk.Advance(24 * time.Hour * 20) // 2026-12-11
		r.BeginRun("next-month")
		if _, err := r.Route(context.Background(), Request{ID: "m3", Task: TaskIntake, Input: "please intake dec", MaxTokens: 64}); err != nil {
			t.Fatal(err)
		}
		if small.Calls() != 2 {
			t.Fatalf("calls %d", small.Calls())
		}
	})

	t.Run("run_resets_daily_does_not", func(t *testing.T) {
		small := exactSmall()
		r := budgetRouter(t, small)
		est, _ := r.Estimate(req, TierSmall)
		r.SetTokenBudgets(est, math.MaxInt64/4, math.MaxInt64/4)
		res1, err := r.Route(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := r.Route(context.Background(), Request{ID: "r2", Task: TaskClassify, Input: "second", MaxTokens: 64}); !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("second call %v", err)
		}
		r.BeginRun("fresh")
		res3, err := r.Route(context.Background(), Request{ID: "r3", Task: TaskClassify, Input: "third", MaxTokens: 64})
		if err != nil {
			t.Fatal(err)
		}
		if small.Calls() != 2 {
			t.Fatalf("calls %d", small.Calls())
		}
		wantDaily := res1.InputTokens + res1.OutputTokens + res3.InputTokens + res3.OutputTokens
		if got := r.Usage().DailyTokens; got != wantDaily {
			t.Fatalf("daily %d want %d", got, wantDaily)
		}
		if got := r.Usage().RunTokens; got != res3.InputTokens+res3.OutputTokens {
			t.Fatalf("run %d want the fresh run only", got)
		}
	})

	t.Run("daily_usd", func(t *testing.T) {
		small := exactSmall()
		r := budgetRouter(t, small)
		r.SetTokenBudgets(math.MaxInt64/4, math.MaxInt64/4, math.MaxInt64/4)
		r.SetUSDBudgets(0, 1e9)
		res, err := r.Route(context.Background(), req)
		if !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("err %v", err)
		}
		traceEqual(t, res.Trace, StateReceived, StateBudgetExceeded)
		if small.Calls() != 0 {
			t.Fatalf("provider called under a zero USD cap: %d", small.Calls())
		}
	})

	t.Run("monthly_usd", func(t *testing.T) {
		small := exactSmall()
		r := budgetRouter(t, small)
		r.SetTokenBudgets(math.MaxInt64/4, math.MaxInt64/4, math.MaxInt64/4)
		r.SetUSDBudgets(1e9, 0)
		if _, err := r.Route(context.Background(), req); !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("err %v", err)
		}
		if small.Calls() != 0 {
			t.Fatalf("calls %d", small.Calls())
		}
	})

	t.Run("rules_ignore_zero_model_budget", func(t *testing.T) {
		small := exactSmall()
		r := budgetRouter(t, small)
		r.SetTokenBudgets(0, 0, 0)
		r.SetUSDBudgets(0, 0)
		res, err := r.Route(context.Background(), Request{ID: "rule", Task: TaskStageLabel, Input: "Hired"})
		if err != nil {
			t.Fatal(err)
		}
		if res.Tier != TierRules || res.Text != "stage: Hired" {
			t.Fatalf("%+v", res)
		}
		if small.Calls() != 0 {
			t.Fatal("model called")
		}
	})

	t.Run("stop_is_not_cached", func(t *testing.T) {
		small := exactSmall()
		r := budgetRouter(t, small)
		r.SetTokenBudgets(0, math.MaxInt64/4, math.MaxInt64/4)
		if _, err := r.Route(context.Background(), req); !errors.Is(err, ErrBudgetExceeded) {
			t.Fatal(err)
		}
		if r.CacheLen() != 0 {
			t.Fatalf("budget stop cached: %d", r.CacheLen())
		}
		r.SetTokenBudgets(math.MaxInt64/4, math.MaxInt64/4, math.MaxInt64/4)
		res, err := r.Route(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		if res.CacheHit || small.Calls() != 1 {
			t.Fatalf("cache=%v calls=%d", res.CacheHit, small.Calls())
		}
	})

	t.Run("escalation_stops_before_big_model", func(t *testing.T) {
		small := NewFakeProvider(TierSmall, func(_ context.Context, req CompletionRequest) (Completion, error) {
			in, out := estimateTokens(req.System, req.Prompt, req.MaxTokens)
			return Completion{Text: "unsure", Confidence: 0.2, InputTokens: int(in), OutputTokens: int(out)}, nil
		})
		big := scripted(TierBig, Completion{Text: "draft", Confidence: 0.9, InputTokens: 100, OutputTokens: 50})
		r := mustRouter(t, DefaultConfig(), Deps{Small: small, Big: big})
		probe := Request{ID: "e", Task: TaskClassify, Input: "ambiguous note", MaxTokens: 32}
		smallEst, _ := r.Estimate(probe, TierSmall)
		// The small call consumes the entire run ceiling, so the big model
		// is refused before Complete.
		r.SetTokenBudgets(smallEst, math.MaxInt64/4, math.MaxInt64/4)
		r.SetUSDBudgets(1e9, 1e9)
		res, err := r.Route(context.Background(), probe)
		if !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("err %v", err)
		}
		if small.Calls() != 1 || big.Calls() != 0 {
			t.Fatalf("small=%d big=%d", small.Calls(), big.Calls())
		}
		traceEqual(t, res.Trace, StateReceived, StateSmallModel, StateEscalated, StateBudgetExceeded)
		if res.Text != "" {
			t.Fatalf("low-confidence text returned: %q", res.Text)
		}
	})

	t.Run("concurrent_reservations_do_not_overshoot", func(t *testing.T) {
		const workers = 80
		const allow = 15
		small := exactSmall()
		r := budgetRouter(t, small)
		probe := Request{ID: "c", Task: TaskClassify, Input: "classify 000 xx", MaxTokens: 64}
		est, _ := r.Estimate(probe, TierSmall)
		r.SetTokenBudgets(int64(allow)*est, int64(allow)*est, int64(allow)*est)
		var wg sync.WaitGroup
		start := make(chan struct{})
		var okN, stopN int64
		var mu sync.Mutex
		for i := 0; i < workers; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				req := Request{
					ID:        "c",
					Task:      TaskClassify,
					Input:     "classify " + pad3(i) + " xx",
					MaxTokens: 64,
				}
				_, err := r.Route(context.Background(), req)
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					okN++
				} else if errors.Is(err, ErrBudgetExceeded) {
					stopN++
				} else {
					t.Errorf("unexpected %v", err)
				}
			}(i)
		}
		close(start)
		wg.Wait()
		if okN != allow || small.Calls() != allow {
			t.Fatalf("ok=%d calls=%d stop=%d", okN, small.Calls(), stopN)
		}
		if got := r.Usage().RunTokens; got != int64(allow)*est {
			t.Fatalf("usage %d limit %d", got, int64(allow)*est)
		}
	})
}

func Test_test_synthetic_workload_hit_rates(t *testing.T) {
	// Cold pass measures the tier mix. The repeat pass measures the cache.
	// The two rates cannot be read off the same pass: a cache hit replaces
	// the tier that produced the original decision.
	//
	// Plan §16: rules ≥ 80%, small ≤ 15%, big ≤ 5%, prompt-cache ≥ 75%.
	// This test's contract, from the task, is ≥ 70% cache on the repeat.
	// The workload clears both.
	//
	// Token sizes follow the plan: small/QC 300, big draft 1,100, rules 0.
	// 0.15*300 + 0.05*1100 = 100, under the 250 average over imported candidates.
	// Latency here is router overhead on fakes. The plan's second-scale
	// p50/p95 figures are model time, which this module does not simulate.
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		return Completion{Text: "classified", Confidence: 0.93, InputTokens: 200, OutputTokens: 100}, nil
	})
	big := NewFakeProvider(TierBig, func(context.Context, CompletionRequest) (Completion, error) {
		return Completion{Text: "draft body", Confidence: 0.96, InputTokens: 800, OutputTokens: 300}, nil
	})
	r := mustRouter(t, DefaultConfig(), Deps{Small: small, Big: big})
	r.BeginRun("cold")
	reqs := SyntheticWorkload()
	if len(reqs) != 1000 {
		t.Fatalf("workload %d", len(reqs))
	}

	cold := routeAll(t, r, reqs)
	var rules, smallN, bigN, cache, tokens int
	var lat []time.Duration
	for _, res := range cold {
		lat = append(lat, res.Latency)
		tokens += int(res.InputTokens + res.OutputTokens)
		switch res.Tier {
		case TierRules:
			rules++
		case TierSmall:
			smallN++
		case TierBig:
			bigN++
		case TierCache:
			cache++
		default:
			t.Fatalf("unexpected tier %s", res.Tier)
		}
	}
	n := float64(len(cold))
	if cache != 0 {
		t.Fatalf("cold cache hits %d", cache)
	}
	assertRate(t, "rules", float64(rules)/n, 0.80, 0.85)
	assertRate(t, "small", float64(smallN)/n, 0.12, 0.15)
	assertRate(t, "big", float64(bigN)/n, 0.01, 0.05)
	if small.Calls() != int64(smallN) || big.Calls() != int64(bigN) {
		t.Fatalf("provider calls small=%d big=%d decisions small=%d big=%d", small.Calls(), big.Calls(), smallN, bigN)
	}
	avg := float64(tokens) / n
	if avg > 250 || avg < 90 {
		t.Fatalf("avg tokens %.1f, want about 100 and <= 250", avg)
	}
	p50 := Percentile(lat, 0.50)
	p95 := Percentile(lat, 0.95)
	t.Logf("cold rules=%.3f small=%.3f big=%.3f avg_tokens=%.1f p50=%s p95=%s",
		float64(rules)/n, float64(smallN)/n, float64(bigN)/n, avg, p50, p95)
	if p50 > 600*time.Millisecond {
		t.Fatalf("p50 %s exceeds QC p50 target 0.6s", p50)
	}
	if p95 > 1500*time.Millisecond {
		t.Fatalf("p95 %s exceeds QC p95 target 1.5s", p95)
	}

	r.BeginRun("warm")
	warm := routeAll(t, r, reqs)
	hits := 0
	for _, res := range warm {
		if res.CacheHit && res.Tier == TierCache && res.InputTokens == 0 && res.OutputTokens == 0 {
			hits++
		}
	}
	hitRate := float64(hits) / float64(len(warm))
	t.Logf("repeat cache hit rate %.3f", hitRate)
	if hitRate < 0.70 {
		t.Fatalf("cache hit rate %.3f, want >= 0.70", hitRate)
	}
	if hitRate < 0.75 {
		t.Fatalf("cache hit rate %.3f is under the plan's 75%% prompt-cache target", hitRate)
	}
	if small.Calls() != int64(smallN) || big.Calls() != int64(bigN) {
		t.Fatalf("repeat called providers small=%d big=%d", small.Calls(), big.Calls())
	}
	snap := r.Snapshot()
	if snap.Calls != 2000 || snap.CacheHits != 1000 || snap.BudgetStops != 0 {
		t.Fatalf("snapshot %+v", snap)
	}
}

func TestProbeReserve0048Billed1600FailsClosed(t *testing.T) {
	// Exact probe: the reservation is $0.048 and the provider bills $16.00.
	// The route must not come back as a completed decision.
	var calls atomic.Int64
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		calls.Add(1)
		return Completion{Text: "billed", Confidence: 0.99, InputTokens: 0, OutputTokens: 1000}, nil
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	cfg.SmallInputUSDPer1K = 0
	cfg.SmallOutputUSDPer1K = 16
	cfg.BigInputUSDPer1K = 0
	cfg.BigOutputUSDPer1K = 0
	cfg.RunTokenBudget = math.MaxInt64 / 4
	cfg.DailyTokenBudget = math.MaxInt64 / 4
	cfg.MonthlyTokenBudget = math.MaxInt64 / 4
	cfg.DailyBudgetUSD = 0.048
	cfg.MonthlyBudgetUSD = 0.048
	r := mustRouter(t, cfg, Deps{Small: small, Big: scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1})})
	req := Request{ID: "probe", Task: TaskClassify, Input: "please classify this note", MaxTokens: 3}
	_, estUSD := r.Estimate(req, TierSmall)
	if math.Abs(estUSD-0.048) > 1e-9 {
		t.Fatalf("reservation usd %.6f, want 0.048", estUSD)
	}
	res, err := r.Route(context.Background(), req)
	if !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("err %v result terminal %s text %q", err, res.Terminal, res.Text)
	}
	if res.Terminal == StateDone || res.Text != "" {
		t.Fatalf("completed route after overage: %+v", res)
	}
	if math.Abs(r.Usage().DailyUSD-16) > 1e-6 || math.Abs(r.Usage().MonthlyUSD-16) > 1e-6 {
		t.Fatalf("usage %+v, want billed 16.00 recorded", r.Usage())
	}
	before := calls.Load()
	_, err = r.Route(context.Background(), Request{ID: "next", Task: TaskClassify, Input: "another note to classify", MaxTokens: 3})
	if !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("later call err %v", err)
	}
	if calls.Load() != before {
		t.Fatalf("later call reached the provider")
	}
}

func TestZeroUSDCeilingStopsZeroEstimate(t *testing.T) {
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		t.Errorf("provider called through a zero USD ceiling")
		return Completion{Text: "no", Confidence: 0.99, InputTokens: 1, OutputTokens: 1}, nil
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	cfg.SmallInputUSDPer1K = 0
	cfg.SmallOutputUSDPer1K = 0
	cfg.BigInputUSDPer1K = 0
	cfg.BigOutputUSDPer1K = 0
	cfg.RunTokenBudget = math.MaxInt64 / 4
	cfg.DailyTokenBudget = math.MaxInt64 / 4
	cfg.MonthlyTokenBudget = math.MaxInt64 / 4
	cfg.DailyBudgetUSD = 0
	cfg.MonthlyBudgetUSD = 0
	r := mustRouter(t, cfg, Deps{Small: small, Big: scripted(TierBig, Completion{Text: "no", Confidence: 1})})
	_, estUSD := r.Estimate(Request{Task: TaskClassify, Input: "hello there", MaxTokens: 8}, TierSmall)
	if estUSD != 0 {
		t.Fatalf("estimate usd %v, want 0", estUSD)
	}
	res, err := r.Route(context.Background(), Request{ID: "z", Task: TaskClassify, Input: "hello there", MaxTokens: 8})
	if !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("err %v terminal %s", err, res.Terminal)
	}
	if small.Calls() != 0 {
		t.Fatalf("calls %d", small.Calls())
	}
}

func TestBudgetBoundariesAndPeriodResets(t *testing.T) {
	if !tokenFits(5, 2, 3, 10) {
		t.Fatal("exact room must fit")
	}
	if tokenFits(5, 2, 4, 10) {
		t.Fatal("room+1 must not fit")
	}
	if tokenFits(0, 0, 0, 0) {
		t.Fatal("zero token ceiling must stop a zero add")
	}
	if !usdFits(0.25, 0.25, 0.50, 1) {
		t.Fatal("usd equal to the ceiling must fit")
	}
	if usdFits(0, 0, 1.01, 1) {
		t.Fatal("limit+0.01 must not fit")
	}
	if usdFits(0, 0, 0, 0) {
		t.Fatal("zero usd ceiling must stop a zero estimate")
	}

	t.Run("daily_token_reset", func(t *testing.T) {
		clk := &manualClock{t: time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)}
		small := exactSmall()
		r := budgetRouterAt(t, small, clk)
		req := Request{ID: "d", Task: TaskClassify, Input: "please classify", MaxTokens: 64}
		est, _ := r.Estimate(req, TierSmall)
		r.SetTokenBudgets(math.MaxInt64/4, est, math.MaxInt64/4)
		if _, err := r.Route(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		if _, err := r.Route(context.Background(), Request{ID: "d2", Task: TaskClassify, Input: "please classify two", MaxTokens: 64}); !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("same day %v", err)
		}
		clk.Advance(24 * time.Hour)
		if _, err := r.Route(context.Background(), Request{ID: "d3", Task: TaskClassify, Input: "please classify three", MaxTokens: 64}); err != nil {
			t.Fatal(err)
		}
		if got := r.Usage().DailyTokens; got != est {
			t.Fatalf("daily tokens after reset %d, want %d", got, est)
		}
	})

	t.Run("daily_usd_reset", func(t *testing.T) {
		clk := &manualClock{t: time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)}
		small := exactSmall()
		cfg := DefaultConfig()
		cfg.CacheEnabled = true
		cfg.SmallInputUSDPer1K = 1
		cfg.SmallOutputUSDPer1K = 1
		cfg.BigInputUSDPer1K = 0
		cfg.BigOutputUSDPer1K = 0
		r := mustRouter(t, cfg, Deps{
			Small: small,
			Big:   scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1}),
			Now:   clk.Now,
		})
		req := Request{ID: "u", Task: TaskClassify, Input: "please classify", MaxTokens: 64}
		_, estUSD := r.Estimate(req, TierSmall)
		r.SetTokenBudgets(math.MaxInt64/4, math.MaxInt64/4, math.MaxInt64/4)
		r.SetUSDBudgets(estUSD, 1e9)
		if _, err := r.Route(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		if _, err := r.Route(context.Background(), Request{ID: "u2", Task: TaskExtract, Input: "please extract two", MaxTokens: 64}); !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("same day usd %v", err)
		}
		clk.Advance(24 * time.Hour)
		if _, err := r.Route(context.Background(), Request{ID: "u3", Task: TaskExtract, Input: "please extract three", MaxTokens: 64}); err != nil {
			t.Fatal(err)
		}
		if math.Abs(r.Usage().DailyUSD-estUSD) > 1e-9 {
			t.Fatalf("daily usd after reset %v, want %v", r.Usage().DailyUSD, estUSD)
		}
	})

	t.Run("monthly_usd_reset", func(t *testing.T) {
		clk := &manualClock{t: time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)}
		small := exactSmall()
		cfg := DefaultConfig()
		cfg.SmallInputUSDPer1K = 1
		cfg.SmallOutputUSDPer1K = 1
		r := mustRouter(t, cfg, Deps{
			Small: small,
			Big:   scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1}),
			Now:   clk.Now,
		})
		req := Request{ID: "m", Task: TaskClassify, Input: "please classify", MaxTokens: 64}
		_, estUSD := r.Estimate(req, TierSmall)
		r.SetTokenBudgets(math.MaxInt64/4, math.MaxInt64/4, math.MaxInt64/4)
		r.SetUSDBudgets(1e9, estUSD)
		if _, err := r.Route(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		clk.Advance(24 * time.Hour)
		if _, err := r.Route(context.Background(), Request{ID: "m2", Task: TaskIntake, Input: "please intake two", MaxTokens: 64}); !errors.Is(err, ErrBudgetExceeded) {
			t.Fatalf("same month usd %v", err)
		}
		clk.Advance(24 * time.Hour * 20)
		if _, err := r.Route(context.Background(), Request{ID: "m3", Task: TaskIntake, Input: "please intake dec", MaxTokens: 64}); err != nil {
			t.Fatal(err)
		}
		if math.Abs(r.Usage().MonthlyUSD-estUSD) > 1e-9 {
			t.Fatalf("monthly usd after reset %v, want %v", r.Usage().MonthlyUSD, estUSD)
		}
	})
}

func TestTimeoutRetriesOnceThenInfra(t *testing.T) {
	var n atomic.Int64
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		n.Add(1)
		return Completion{}, context.DeadlineExceeded
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{Small: small, Big: scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1})})
	_, err := r.Route(context.Background(), Request{ID: "t", Task: TaskClassify, Input: "deadline please", MaxTokens: 32})
	if n.Load() != 2 {
		t.Fatalf("attempts %d, want 2", n.Load())
	}
	if !errors.Is(err, ErrInfra) {
		t.Fatalf("err %v, want infra", err)
	}
	if r.InfraErrors() != 1 {
		t.Fatalf("infra count %d", r.InfraErrors())
	}
}

func TestTimeoutRetryThenSuccess(t *testing.T) {
	var n atomic.Int64
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		if n.Add(1) == 1 {
			return Completion{}, context.DeadlineExceeded
		}
		return Completion{Text: "ok", Confidence: 0.95, InputTokens: 4, OutputTokens: 2}, nil
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{Small: small, Big: scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1})})
	res, err := r.Route(context.Background(), Request{ID: "t", Task: TaskClassify, Input: "retry please", MaxTokens: 32})
	if err != nil {
		t.Fatal(err)
	}
	if n.Load() != 2 || res.Tier != TierSmall || res.Text != "ok" {
		t.Fatalf("attempts %d tier %s text %q", n.Load(), res.Tier, res.Text)
	}
	if r.InfraErrors() != 0 {
		t.Fatalf("infra %d", r.InfraErrors())
	}
}

func TestNonTimeoutProviderErrorDoesNotRetry(t *testing.T) {
	const key = "notarealkey"
	var n atomic.Int64
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		n.Add(1)
		return Completion{}, errors.New("provider failed " + key)
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{Small: small, Big: scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1})})
	_, err := r.Route(context.Background(), Request{ID: "e", Task: TaskClassify, Input: "plain error", MaxTokens: 32})
	if n.Load() != 1 {
		t.Fatalf("attempts %d", n.Load())
	}
	if err == nil || strings.Contains(err.Error(), key) {
		t.Fatalf("err %v", err)
	}
}

func TestEnvValuesNeverLogged(t *testing.T) {
	const secret = "zz9f3c1b"
	const dailyRaw = "4.125"
	const monthlyRaw = "19.875"
	const bad = "zzbadval"
	names := []string{}
	cfg, err := LoadConfig(func(name string) (string, bool) {
		names = append(names, name)
		switch name {
		case EnvAnthropicAPIKey:
			return secret, true
		case EnvDailyBudgetUSD:
			return "  " + dailyRaw + " ", true
		case EnvMonthlyBudgetUSD:
			return monthlyRaw, true
		default:
			t.Errorf("unexpected env name %s", name)
			return "", false
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names, ",") != EnvAnthropicAPIKey+","+EnvDailyBudgetUSD+","+EnvMonthlyBudgetUSD {
		t.Fatalf("lookups %v", names)
	}
	if !cfg.AnthropicKeyPresent || cfg.DailyBudgetUSD != 4.125 || cfg.MonthlyBudgetUSD != 19.875 {
		t.Fatalf("config key=%v daily=%v monthly=%v", cfg.AnthropicKeyPresent, cfg.DailyBudgetUSD, cfg.MonthlyBudgetUSD)
	}
	assertNoSecret(t, reflect.ValueOf(cfg), secret)
	for _, c := range cfg.Consultation() {
		if strings.Contains(c.Name, secret) || strings.Contains(c.Name, dailyRaw) {
			t.Fatalf("consultation leaked %+v", c)
		}
	}

	r, err := NewFromEnv(func(name string) (string, bool) {
		switch name {
		case EnvAnthropicAPIKey:
			return secret, true
		case EnvDailyBudgetUSD:
			return dailyRaw, true
		case EnvMonthlyBudgetUSD:
			return monthlyRaw, true
		default:
			return "", false
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	sentinel := "INPUT-SENTINEL-77"
	res, err := r.Route(context.Background(), Request{ID: sentinel, Task: TaskStageLabel, Input: "QM"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Tier != TierRules {
		t.Fatalf("tier %s", res.Tier)
	}
	assertNoSecret(t, reflect.ValueOf(r).Elem(), secret)
	blob := strings.Join(r.LogLines(), "\n")
	for _, leak := range []string{secret, dailyRaw, monthlyRaw, sentinel, "QM"} {
		if strings.Contains(blob, leak) {
			t.Fatalf("log contains %q\n%s", leak, blob)
		}
	}
	for _, name := range []string{EnvAnthropicAPIKey, EnvDailyBudgetUSD, EnvMonthlyBudgetUSD} {
		if !strings.Contains(blob, "env name="+name+" present=true") {
			t.Fatalf("log missing name %s\n%s", name, blob)
		}
	}

	_, err = LoadConfig(func(name string) (string, bool) {
		if name == EnvDailyBudgetUSD {
			return bad, true
		}
		return "", false
	})
	if err == nil {
		t.Fatal("expected parse error")
	}
	if strings.Contains(err.Error(), "zzbad") || strings.Contains(err.Error(), bad) {
		t.Fatalf("error echoes value: %v", err)
	}
	if !strings.Contains(err.Error(), EnvDailyBudgetUSD) {
		t.Fatalf("error %v", err)
	}

	t.Run("provider_error_and_repanic", func(t *testing.T) {
		const key = "notarealkey"
		panicProvider := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
			panic(key)
		})
		cfg := DefaultConfig()
		cfg.CacheEnabled = false
		r := mustRouter(t, cfg, Deps{
			Small: panicProvider,
			Big:   scripted(TierBig, Completion{Text: "no", Confidence: 1, InputTokens: 1, OutputTokens: 1}),
		})
		var repanic any
		func() {
			defer func() { repanic = recover() }()
			_, err := r.Route(context.Background(), Request{ID: "p", Task: TaskClassify, Input: "panic path", MaxTokens: 16})
			if err != nil && strings.Contains(err.Error(), key) {
				t.Fatalf("error carries key")
			}
		}()
		if repanic != nil && strings.Contains(fmt.Sprint(repanic), key) {
			t.Fatal("re-panic carries the value")
		}
		assertPackageLevelOmitsKey(t, key)
	})
}

func assertPackageLevelOmitsKey(t *testing.T, key string) {
	t.Helper()
	matches, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, name := range matches {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.VAR {
				continue
			}
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for _, value := range vs.Values {
					lit, ok := value.(*ast.BasicLit)
					if ok && strings.Contains(lit.Value, key) {
						t.Fatalf("%s package var holds the key", name)
					}
				}
			}
		}
		body, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(body), key) {
			t.Fatalf("%s holds the key", name)
		}
	}
	for _, s := range []string{systemSmall, systemBig} {
		if strings.Contains(s, key) {
			t.Fatal("package string holds the key")
		}
	}
}

func TestProvidersStayOffline(t *testing.T) {
	allowed := map[string]bool{
		"context": true, "crypto/sha256": true, "encoding/hex": true,
		"errors": true, "fmt": true, "math": true, "sort": true,
		"strconv": true, "strings": true, "sync": true, "sync/atomic": true,
		"time": true,
	}
	matches, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, name := range matches {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range file.Imports {
			path := strings.Trim(imp.Path.Value, `"`)
			if path == "net" || path == "net/http" || strings.Contains(path, "anthropic") || strings.Contains(path, "openai") {
				t.Fatalf("%s imports %s", name, path)
			}
			if !allowed[path] {
				t.Fatalf("%s imports %s, which this module does not allow", name, path)
			}
		}
	}
	if _, err := os.Stat("go.sum"); err == nil {
		body, _ := os.ReadFile("go.sum")
		if len(strings.TrimSpace(string(body))) != 0 {
			t.Fatal("go.sum should stay empty; this module has no dependencies")
		}
	}
}

func TestStateMachineRejectsIllegalTransitions(t *testing.T) {
	m := NewMachine()
	if err := m.Transition(StateDone); err == nil {
		t.Fatal("received -> done")
	}
	if err := m.Transition(StateBigModel); err == nil {
		t.Fatal("received -> big_model")
	}
	if err := m.Transition(StateRuleHit); err != nil {
		t.Fatal(err)
	}
	if err := m.Transition(StateSmallModel); err == nil {
		t.Fatal("rule_hit -> small_model")
	}
	if got := m.State(); got != StateRuleHit {
		t.Fatalf("state changed on a rejected edge: %s", got)
	}
	done := NewMachine()
	for _, s := range []State{StateCached, StateDone} {
		if err := done.Transition(s); err != nil {
			t.Fatal(err)
		}
	}
	if err := done.Transition(StateCached); err == nil {
		t.Fatal("done is terminal")
	}
}

func mustRouter(t *testing.T, cfg Config, deps Deps) *Router {
	t.Helper()
	r, err := New(cfg, deps)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func scripted(tier Tier, c Completion) *FakeProvider {
	return NewFakeProvider(tier, func(context.Context, CompletionRequest) (Completion, error) {
		return c, nil
	})
}

func exactSmall() *FakeProvider {
	return NewFakeProvider(TierSmall, func(_ context.Context, req CompletionRequest) (Completion, error) {
		in, out := estimateTokens(req.System, req.Prompt, req.MaxTokens)
		return Completion{Text: "label:ok", Confidence: 0.95, InputTokens: int(in), OutputTokens: int(out)}, nil
	})
}

func budgetRouter(t *testing.T, small *FakeProvider) *Router {
	t.Helper()
	return budgetRouterAt(t, small, nil)
}

func budgetRouterAt(t *testing.T, small *FakeProvider, clk *manualClock) *Router {
	t.Helper()
	cfg := DefaultConfig()
	cfg.SmallInputUSDPer1K = 1
	cfg.SmallOutputUSDPer1K = 1
	cfg.BigInputUSDPer1K = 1
	cfg.BigOutputUSDPer1K = 1
	deps := Deps{
		Small: small,
		Big:   scripted(TierBig, Completion{Text: "big", Confidence: 0.9, InputTokens: 10, OutputTokens: 10}),
	}
	if clk != nil {
		deps.Now = clk.Now
	}
	r := mustRouter(t, cfg, deps)
	r.SetUSDBudgets(1e9, 1e9)
	return r
}

func routeAll(t *testing.T, r *Router, reqs []Request) []Result {
	t.Helper()
	out := make([]Result, 0, len(reqs))
	for _, req := range reqs {
		res, err := r.Route(context.Background(), req)
		if err != nil {
			t.Fatalf("route %s: %v", req.ID, err)
		}
		out = append(out, res)
	}
	return out
}

func assertRate(t *testing.T, name string, got, lo, hi float64) {
	t.Helper()
	if got < lo || got > hi {
		t.Fatalf("%s rate %.3f, want %.2f..%.2f", name, got, lo, hi)
	}
}

func traceEqual(t *testing.T, got []State, want ...State) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("trace %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("trace %v want %v", got, want)
		}
	}
}

func pad3(i int) string {
	s := []byte{'0', '0', '0'}
	s[2] = byte('0' + i%10)
	s[1] = byte('0' + (i/10)%10)
	s[0] = byte('0' + (i/100)%10)
	return string(s)
}

func assertNoSecret(t *testing.T, v reflect.Value, secret string) {
	t.Helper()
	seen := map[uintptr]bool{}
	var walk func(reflect.Value)
	walk = func(v reflect.Value) {
		if !v.IsValid() {
			return
		}
		switch v.Kind() {
		case reflect.String:
			if strings.Contains(v.String(), secret) {
				t.Fatalf("retained secret")
			}
		case reflect.Ptr, reflect.Interface:
			if v.IsNil() {
				return
			}
			if v.Kind() == reflect.Ptr {
				if v.Pointer() == 0 || seen[v.Pointer()] {
					return
				}
				seen[v.Pointer()] = true
			}
			walk(v.Elem())
		case reflect.Struct:
			for i := 0; i < v.NumField(); i++ {
				walk(v.Field(i))
			}
		case reflect.Slice, reflect.Array:
			for i := 0; i < v.Len(); i++ {
				walk(v.Index(i))
			}
		case reflect.Map:
			for _, k := range v.MapKeys() {
				walk(k)
				walk(v.MapIndex(k))
			}
		}
	}
	walk(v)
}

type manualClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *manualClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *manualClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}
