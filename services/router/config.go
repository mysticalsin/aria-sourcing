package router

import (
	"errors"
	"math"
	"strconv"
	"strings"
	"time"
)

// Environment variable names consulted for provider configuration.
// LoadConfig reads these names and never logs the values.
const (
	EnvAnthropicAPIKey  = "ANTHROPIC_API_KEY"
	EnvDailyBudgetUSD   = "AI_DAILY_BUDGET_USD"
	EnvMonthlyBudgetUSD = "AI_MONTHLY_BUDGET_USD"
)

// Reason values recorded on a result. They are a closed vocabulary so a
// log line cannot carry request text or an environment value.
const (
	ReasonRules      = "rules"
	ReasonCache      = "cache"
	ReasonSmall      = "small"
	ReasonConfidence = "confidence"
	ReasonComplexity = "complexity"
	ReasonBudget     = "budget"
	ReasonFallback   = "fallback"
)

// Prompt caps. PromptPolicyChars matches the extract trim in
// src/lib/ai/intake.ts (text.slice(0, 12_000)). A classify or extract call
// that is below the confidence threshold is retried on the small tier with
// LowConfidencePromptChars, not sent to the big tier.
const (
	PromptPolicyChars        = 12000
	LowConfidencePromptChars = 2000
)

// ConsultedEnv records that a named variable was looked up. The value is
// not retained.
type ConsultedEnv struct {
	Name    string
	Present bool
}

// Config is the router's policy. Zero USD and token budgets are hard stops
// for model calls. Construct with DefaultConfig and then override.
type Config struct {
	ConfidenceThreshold float64
	CacheTTL            time.Duration
	CacheEnabled        bool
	PolicyVersion       string

	RunTokenBudget     int64
	DailyTokenBudget   int64
	MonthlyTokenBudget int64

	DailyBudgetUSD   float64
	MonthlyBudgetUSD float64

	SmallInputUSDPer1K  float64
	SmallOutputUSDPer1K float64
	BigInputUSDPer1K    float64
	BigOutputUSDPer1K   float64

	// AnthropicKeyPresent is true when ANTHROPIC_API_KEY is set to a
	// non-empty value. The value itself is discarded inside LoadConfig.
	AnthropicKeyPresent bool

	// RouteDeadline is the router's own timeout, applied even when the
	// caller passes a context with no deadline. Zero is not applied.
	RouteDeadline time.Duration

	consulted []ConsultedEnv
}

// DefaultConfig matches the plan's USD caps (6 a day, 30 a month) and
// leaves enough token headroom for a synthetic batch. Model calls still
// stop when either ceiling is reached.
func DefaultConfig() Config {
	return Config{
		ConfidenceThreshold: 0.80,
		CacheTTL:            24 * time.Hour,
		CacheEnabled:        true,
		PolicyVersion:       "router-v1",
		RunTokenBudget:      200_000,
		DailyTokenBudget:    2_000_000,
		MonthlyTokenBudget:  20_000_000,
		DailyBudgetUSD:      6,
		MonthlyBudgetUSD:    30,
		// USD per 1K tokens, from src/lib/ai/model-prices.json (USD per 1M / 1000).
		// Small is claude-haiku-5-5. Big is claude-sonnet-5-5.
		SmallInputUSDPer1K:  0.0001,
		SmallOutputUSDPer1K: 0.0005,
		BigInputUSDPer1K:    0.002,
		BigOutputUSDPer1K:   0.01,
		RouteDeadline:       3 * time.Second,
	}
}

// Consultation returns the env names LoadConfig looked up, and whether each
// was non-empty. Values are not included.
func (c Config) Consultation() []ConsultedEnv {
	out := make([]ConsultedEnv, len(c.consulted))
	copy(out, c.consulted)
	return out
}

// LoadConfig reads provider configuration. lookup is typically os.LookupEnv.
// Only EnvAnthropicAPIKey, EnvDailyBudgetUSD, and EnvMonthlyBudgetUSD are
// read. The key value is reduced to a boolean and dropped. Budget parse
// errors name the variable and do not echo the raw string.
func LoadConfig(lookup func(string) (string, bool)) (Config, error) {
	cfg := DefaultConfig()
	if lookup == nil {
		return Config{}, errors.New("nil env lookup")
	}

	cfg.AnthropicKeyPresent = lookupPresent(lookup, EnvAnthropicAPIKey)
	cfg.consulted = append(cfg.consulted, ConsultedEnv{Name: EnvAnthropicAPIKey, Present: cfg.AnthropicKeyPresent})

	daily, dailySet, err := lookupNumber(lookup, EnvDailyBudgetUSD)
	if err != nil {
		return Config{}, err
	}
	cfg.consulted = append(cfg.consulted, ConsultedEnv{Name: EnvDailyBudgetUSD, Present: dailySet})
	if dailySet {
		cfg.DailyBudgetUSD = daily
	}

	monthly, monthlySet, err := lookupNumber(lookup, EnvMonthlyBudgetUSD)
	if err != nil {
		return Config{}, err
	}
	cfg.consulted = append(cfg.consulted, ConsultedEnv{Name: EnvMonthlyBudgetUSD, Present: monthlySet})
	if monthlySet {
		cfg.MonthlyBudgetUSD = monthly
	}
	return cfg, nil
}

func lookupPresent(lookup func(string) (string, bool), name string) bool {
	v, ok := lookup(name)
	if !ok {
		return false
	}
	return strings.TrimSpace(v) != ""
}

func lookupNumber(lookup func(string) (string, bool), name string) (float64, bool, error) {
	v, ok := lookup(name)
	if !ok {
		return 0, false, nil
	}
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return 0, false, nil
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
		return 0, true, errors.New(name + " must be a non-negative number")
	}
	return n, true, nil
}
