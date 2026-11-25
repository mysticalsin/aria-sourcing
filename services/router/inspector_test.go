package router

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStageKeyToRateIsARuleNotALabel(t *testing.T) {
	small := NewFakeProvider(TierSmall, nil)
	big := NewFakeProvider(TierBig, nil)
	r := mustRouter(t, DefaultConfig(), Deps{Small: small, Big: big})
	res, err := r.Route(context.Background(), Request{ID: "st", Task: TaskStageLabel, Input: "to_rate"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Tier != TierRules || res.Text != "stage: to_rate" || small.Calls() != 0 || big.Calls() != 0 {
		t.Fatalf("to_rate tier %s text %q calls %d/%d", res.Tier, res.Text, small.Calls(), big.Calls())
	}
	label, err := r.Route(context.Background(), Request{ID: "st2", Task: TaskStageLabel, Input: "To Rate"})
	if err != nil {
		t.Fatal(err)
	}
	if label.Tier == TierRules {
		t.Fatalf("label matched: %q", label.Text)
	}
}

func TestMissingSuppressionFlagDenies(t *testing.T) {
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{Small: NewFakeProvider(TierSmall, nil), Big: NewFakeProvider(TierBig, nil)})
	for _, fields := range []map[string]string{nil, {}, {"suppressed": "  "}} {
		res, err := r.Route(context.Background(), Request{ID: "sup", Task: TaskSuppression, Fields: fields})
		if err != nil {
			t.Fatal(err)
		}
		if res.Tier != TierRules || !strings.Contains(res.Text, "Do not contact") || strings.Contains(res.Text, "not set") {
			t.Fatalf("fields %v -> %q", fields, res.Text)
		}
	}
}

func TestClassifyExtractBelowThresholdStaysSmallAndTrims(t *testing.T) {
	input := strings.Repeat("a", 4000) + "TAILMARKER"
	var prompts []string
	small := NewFakeProvider(TierSmall, func(_ context.Context, req CompletionRequest) (Completion, error) {
		prompts = append(prompts, req.Prompt)
		return Completion{Text: "unsure", Confidence: 0.1, InputTokens: 4, OutputTokens: 2}, nil
	})
	big := NewFakeProvider(TierBig, func(context.Context, CompletionRequest) (Completion, error) {
		t.Fatal("classify went to the big tier")
		return Completion{}, errors.New("big")
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{Small: small, Big: big})
	res, err := r.Route(context.Background(), Request{ID: "c", Task: TaskClassify, Input: input, MaxTokens: 32})
	if err != nil {
		t.Fatal(err)
	}
	if res.Tier != TierSmall || big.Calls() != 0 || len(prompts) != 2 {
		t.Fatalf("tier %s big %d prompts %d", res.Tier, big.Calls(), len(prompts))
	}
	if strings.Contains(prompts[1], "TAILMARKER") || len(prompts[1]) >= len(prompts[0]) {
		t.Fatal("second prompt was not trimmed")
	}
}

func TestProviderErrorAndDeadlineFallBack(t *testing.T) {
	const key = "notarealkey"
	small := NewFakeProvider(TierSmall, func(context.Context, CompletionRequest) (Completion, error) {
		return Completion{}, errors.New("provider failed " + key)
	})
	cfg := DefaultConfig()
	cfg.CacheEnabled = false
	r := mustRouter(t, cfg, Deps{Small: small, Big: NewFakeProvider(TierBig, nil)})
	res, err := r.Route(context.Background(), Request{ID: "e", Task: TaskClassify, Input: "hello there", MaxTokens: 16})
	if err != nil || strings.Contains(res.Text, key) || !strings.Contains(res.Text, "UNCLEAR") {
		t.Fatalf("err %v text %q", err, res.Text)
	}

	var attempts int
	blocking := NewFakeProvider(TierSmall, func(ctx context.Context, _ CompletionRequest) (Completion, error) {
		attempts++
		select {
		case <-ctx.Done():
			return Completion{}, ctx.Err()
		case <-time.After(2 * time.Second):
			return Completion{Text: "late-ok", Confidence: 0.99, InputTokens: 1, OutputTokens: 1}, nil
		}
	})
	cfg.RouteDeadline = 40 * time.Millisecond
	r = mustRouter(t, cfg, Deps{Small: blocking, Big: NewFakeProvider(TierBig, nil)})
	start := time.Now()
	res, err = r.Route(context.Background(), Request{ID: "d", Task: TaskExtract, Input: "brief text", MaxTokens: 16})
	if time.Since(start) > time.Second || err != nil || res.Text == "late-ok" || attempts != 2 || r.InfraErrors() != 1 {
		t.Fatalf("elapsed %s err %v text %q attempts %d infra %d", time.Since(start), err, res.Text, attempts, r.InfraErrors())
	}
}

func TestInFlightReservationCountsAfterBeginRun(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	l := newLedger(Config{
		RunTokenBudget: 100, DailyTokenBudget: 1000, MonthlyTokenBudget: 1000,
		DailyBudgetUSD: 10, MonthlyBudgetUSD: 10,
	})
	h, err := l.tryReserve(now, 80, 0)
	if err != nil {
		t.Fatal(err)
	}
	l.beginRun("next")
	if _, err := l.tryReserve(now, 30, 0); !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("in-flight reserve was invisible: %v", err)
	}
	if err := l.commit(h, 80, 0); err != nil {
		t.Fatal(err)
	}
	if got := l.usage().RunTokens; got != 80 {
		t.Fatalf("run tokens %d, want the in-flight 80 on the new run", got)
	}
}

func TestPricesMatchAgentsUsage(t *testing.T) {
	raw, err := os.ReadFile("prices.json")
	if err != nil {
		t.Fatalf("shared price file: %v", err)
	}
	var doc struct {
		USDPerMillion map[string]struct {
			Input  float64 `json:"input"`
			Output float64 `json:"output"`
		} `json:"usdPerMillion"`
		SmallModel string `json:"smallModel"`
		BigModel   string `json:"bigModel"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	cfg := DefaultConfig()
	small := doc.USDPerMillion[doc.SmallModel]
	big := doc.USDPerMillion[doc.BigModel]
	if math.Abs(cfg.SmallInputUSDPer1K-small.Input/1000) > 1e-12 || math.Abs(cfg.SmallOutputUSDPer1K-small.Output/1000) > 1e-12 {
		t.Fatalf("small prices %v/%v vs json %v/%v", cfg.SmallInputUSDPer1K, cfg.SmallOutputUSDPer1K, small.Input, small.Output)
	}
	if math.Abs(cfg.BigInputUSDPer1K-big.Input/1000) > 1e-12 || math.Abs(cfg.BigOutputUSDPer1K-big.Output/1000) > 1e-12 {
		t.Fatalf("big prices %v/%v vs json %v/%v", cfg.BigInputUSDPer1K, cfg.BigOutputUSDPer1K, big.Input, big.Output)
	}
}

func TestLedgerDocumentedInMemory(t *testing.T) {
	readme, err := os.ReadFile("README.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(readme), "The ledger is in memory only") {
		t.Fatal("ledger persistence is not documented")
	}
}

func TestProvidersDoNotAcceptKeys(t *testing.T) {
	source, err := os.ReadFile("provider.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	if !strings.Contains(text, "do not dial out") || !strings.Contains(text, "do not accept an API key") {
		t.Fatal("provider contract drifted")
	}
}
