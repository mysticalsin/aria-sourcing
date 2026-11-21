package router

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	systemSmall = "You are Aria's small model. Classify or extract. Return only the result. Suggestion only."
	systemBig   = "You are Aria's big model. Draft the requested text. Suggestion only; a human approves sends."
)

// Request is one routing decision. ID is not part of the cache key.
type Request struct {
	ID          string
	Task        Task
	Input       string
	Fields      map[string]string
	Shortlisted bool
	MaxTokens   int
}

// ProviderCall is the token and latency record for one provider invocation.
type ProviderCall struct {
	Tier         Tier
	InputTokens  int64
	OutputTokens int64
	Latency      time.Duration
	USD          float64
}

// Result is the outcome of Route, including the state trace.
type Result struct {
	RequestID     string
	Text          string
	Tier          Tier
	Trace         []State
	Terminal      State
	CacheHit      bool
	InputTokens   int64
	OutputTokens  int64
	Latency       time.Duration
	Confidence    float64
	Reason        string
	USD           float64
	ProviderCalls []ProviderCall
}

// CallMetric is the per-request view kept for snapshots.
type CallMetric struct {
	RequestID     string
	Tier          Tier
	Trace         []State
	Terminal      State
	CacheHit      bool
	InputTokens   int64
	OutputTokens  int64
	Latency       time.Duration
	Confidence    float64
	Reason        string
	USD           float64
	ProviderCalls []ProviderCall
}

// Snapshot aggregates recorded requests.
type Snapshot struct {
	Calls        int
	Rules        int
	Small        int
	Big          int
	CacheHits    int
	BudgetStops  int
	InputTokens  int64
	OutputTokens int64
	Latencies    []time.Duration
}

// Deps are the replaceable edges. Nil providers become fakes. Now defaults
// to time.Now and is the clock for cache TTL and budget windows. Latency
// uses the process clock so a frozen Now cannot hide a slow call.
type Deps struct {
	Small Provider
	Big   Provider
	Now   func() time.Time
}

// Router routes one request at a time through the state machine. Concurrent
// Route calls share the cache and the budget ledger safely.
type Router struct {
	cfg    Config
	small  Provider
	big    Provider
	cache  *resultCache
	ledger *ledger
	now    func() time.Time

	mu      sync.Mutex
	metrics []CallMetric
	logs    []string
	infra   atomic.Int64
}

// New builds a router. Providers that are nil are fakes. A non-nil provider
// must report the tier it is wired as.
func New(cfg Config, deps Deps) (*Router, error) {
	if cfg.PolicyVersion == "" {
		cfg.PolicyVersion = "router-v1"
	}
	if err := validate(cfg); err != nil {
		return nil, err
	}
	if deps.Small == nil {
		deps.Small = NewFakeProvider(TierSmall, nil)
	}
	if deps.Big == nil {
		deps.Big = NewFakeProvider(TierBig, nil)
	}
	if deps.Small.Tier() != TierSmall || deps.Big.Tier() != TierBig {
		return nil, errors.New("provider tier mismatch")
	}
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	r := &Router{
		cfg:    cfg,
		small:  deps.Small,
		big:    deps.Big,
		cache:  newResultCache(),
		ledger: newLedger(cfg),
		now:    now,
	}
	for _, c := range cfg.consulted {
		present := "false"
		if c.Present {
			present = "true"
		}
		r.logs = append(r.logs, "env name="+c.Name+" present="+present)
	}
	return r, nil
}

func validate(cfg Config) error {
	if cfg.ConfidenceThreshold <= 0 || cfg.ConfidenceThreshold > 1 || math.IsNaN(cfg.ConfidenceThreshold) {
		return errors.New("confidence threshold must be in (0, 1]")
	}
	if cfg.RunTokenBudget < 0 || cfg.DailyTokenBudget < 0 || cfg.MonthlyTokenBudget < 0 {
		return errors.New("token budgets must be >= 0")
	}
	if badUSD(cfg.DailyBudgetUSD) || badUSD(cfg.MonthlyBudgetUSD) {
		return errors.New("USD budgets must be >= 0")
	}
	if cfg.CacheTTL < 0 {
		return errors.New("cache TTL must be >= 0")
	}
	if badUSD(cfg.SmallInputUSDPer1K) || badUSD(cfg.SmallOutputUSDPer1K) ||
		badUSD(cfg.BigInputUSDPer1K) || badUSD(cfg.BigOutputUSDPer1K) {
		return errors.New("token prices must be >= 0")
	}
	return nil
}

func badUSD(v float64) bool {
	return v < 0 || math.IsNaN(v) || math.IsInf(v, 0)
}

// NewFromEnv loads configuration and wires fake providers. A present
// ANTHROPIC_API_KEY does not change that: this module has no live client.
func NewFromEnv(lookup func(string) (string, bool)) (*Router, error) {
	cfg, err := LoadConfig(lookup)
	if err != nil {
		return nil, err
	}
	return New(cfg, Deps{})
}

// BeginRun opens a run. The per-run token counter resets. Daily and monthly
// counters, and the prompt cache, stay.
func (r *Router) BeginRun(id string) {
	r.ledger.beginRun(id)
}

// SetTokenBudgets replaces the per-run, daily, and monthly token ceilings.
func (r *Router) SetTokenBudgets(run, daily, monthly int64) {
	r.ledger.setTokenLimits(run, daily, monthly)
}

// SetUSDBudgets replaces the daily and monthly USD ceilings.
func (r *Router) SetUSDBudgets(daily, monthly float64) {
	r.ledger.setUSDLimits(daily, monthly)
}

// Usage returns committed model spend.
func (r *Router) Usage() Usage { return r.ledger.usage() }

// CacheLen is the number of unexpired and expired entries still stored.
func (r *Router) CacheLen() int { return r.cache.len() }

// LogLines returns operational lines. They name env vars and counts. They
// do not include env values, prompts, or model text.
func (r *Router) LogLines() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.logs))
	copy(out, r.logs)
	return out
}

// Metrics returns a copy of the per-request records.
func (r *Router) Metrics() []CallMetric {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]CallMetric, len(r.metrics))
	copy(out, r.metrics)
	return out
}

// Snapshot aggregates Metrics.
func (r *Router) Snapshot() Snapshot {
	metrics := r.Metrics()
	var s Snapshot
	s.Calls = len(metrics)
	s.Latencies = make([]time.Duration, 0, len(metrics))
	for _, m := range metrics {
		s.InputTokens += m.InputTokens
		s.OutputTokens += m.OutputTokens
		s.Latencies = append(s.Latencies, m.Latency)
		switch {
		case m.Terminal == StateBudgetExceeded:
			s.BudgetStops++
		case m.CacheHit:
			s.CacheHits++
		case m.Tier == TierRules:
			s.Rules++
		case m.Tier == TierSmall:
			s.Small++
		case m.Tier == TierBig:
			s.Big++
		}
	}
	return s
}

// Estimate is the reservation Route will take before calling tier.
func (r *Router) Estimate(req Request, tier Tier) (tokens int64, usd float64) {
	in, out := r.tokenEstimate(req, tier)
	return in + out, costUSD(r.cfg, tier, in, out)
}

// Route runs the state machine for one request.
func (r *Router) Route(ctx context.Context, req Request) (Result, error) {
	start := time.Now()
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	m := NewMachine()
	key := cacheKey(r.cfg, req)

	if r.cfg.CacheEnabled {
		if hit, ok := r.cache.get(key, r.now()); ok {
			if err := m.Transition(StateCached); err != nil {
				return Result{}, err
			}
			if err := m.Transition(StateDone); err != nil {
				return Result{}, err
			}
			res := Result{
				RequestID:  req.ID,
				Text:       hit.text,
				Tier:       TierCache,
				Trace:      m.Trace(),
				Terminal:   StateDone,
				CacheHit:   true,
				Latency:    time.Since(start),
				Confidence: hit.confidence,
				Reason:     ReasonCache,
			}
			r.finish(res)
			return res, nil
		}
	}

	if match, ok := applyRules(req); ok {
		if err := m.Transition(StateRuleHit); err != nil {
			return Result{}, err
		}
		res := Result{
			RequestID:  req.ID,
			Text:       match.text,
			Tier:       TierRules,
			Confidence: 1,
			Reason:     ReasonRules,
		}
		return r.succeed(m, key, res, nil, start)
	}

	acc := &accumulator{}
	if requiresBigModel(req) {
		if err := m.Transition(StateSmallModel); err != nil {
			return Result{}, err
		}
		if err := m.Transition(StateEscalated); err != nil {
			return Result{}, err
		}
		return r.runBig(ctx, m, req, key, acc, start, ReasonComplexity)
	}

	estTokens, estUSD := r.Estimate(req, TierSmall)
	h, err := r.ledger.tryReserve(r.now(), estTokens, estUSD)
	if errors.Is(err, ErrBudgetExceeded) {
		return r.budgetStop(m, req, acc, start)
	}
	if err != nil {
		return Result{}, err
	}
	if err := m.Transition(StateSmallModel); err != nil {
		r.ledger.cancel(h)
		return Result{}, err
	}
	comp, call, err := r.call(ctx, r.small, TierSmall, req, promptLimit(req, false))
	if err != nil {
		r.ledger.cancel(h)
		return r.providerFallback(m, req, acc, start, err)
	}
	if err := r.ledger.commit(h, call.InputTokens+call.OutputTokens, call.USD); err != nil {
		acc.add(call)
		return r.budgetStop(m, req, acc, start)
	}
	acc.add(call)

	if !confident(comp, r.cfg.ConfidenceThreshold) {
		if req.Task == TaskClassify || req.Task == TaskExtract {
			return r.retrySmallTrimmed(ctx, m, req, key, acc, start)
		}
		if err := m.Transition(StateEscalated); err != nil {
			return Result{}, err
		}
		return r.runBig(ctx, m, req, key, acc, start, ReasonConfidence)
	}

	res := Result{
		RequestID:  req.ID,
		Text:       comp.Text,
		Tier:       TierSmall,
		Confidence: comp.Confidence,
		Reason:     ReasonSmall,
	}
	return r.succeed(m, key, res, acc, start)
}

func (r *Router) runBig(ctx context.Context, m *Machine, req Request, key string, acc *accumulator, start time.Time, reason string) (Result, error) {
	estTokens, estUSD := r.Estimate(req, TierBig)
	h, err := r.ledger.tryReserve(r.now(), estTokens, estUSD)
	if errors.Is(err, ErrBudgetExceeded) {
		return r.budgetStop(m, req, acc, start)
	}
	if err != nil {
		return Result{}, err
	}
	if err := m.Transition(StateBigModel); err != nil {
		r.ledger.cancel(h)
		return Result{}, err
	}
	comp, call, err := r.call(ctx, r.big, TierBig, req, 0)
	if err != nil {
		r.ledger.cancel(h)
		return r.providerFallback(m, req, acc, start, err)
	}
	if err := r.ledger.commit(h, call.InputTokens+call.OutputTokens, call.USD); err != nil {
		acc.add(call)
		return r.budgetStop(m, req, acc, start)
	}
	acc.add(call)
	res := Result{
		RequestID:  req.ID,
		Text:       comp.Text,
		Tier:       TierBig,
		Confidence: comp.Confidence,
		Reason:     reason,
	}
	return r.succeed(m, key, res, acc, start)
}

func (r *Router) retrySmallTrimmed(ctx context.Context, m *Machine, req Request, key string, acc *accumulator, start time.Time) (Result, error) {
	estTokens, estUSD := r.Estimate(req, TierSmall)
	h, err := r.ledger.tryReserve(r.now(), estTokens, estUSD)
	if errors.Is(err, ErrBudgetExceeded) {
		return r.budgetStop(m, req, acc, start)
	}
	if err != nil {
		return Result{}, err
	}
	comp, call, err := r.call(ctx, r.small, TierSmall, req, promptLimit(req, true))
	if err != nil {
		r.ledger.cancel(h)
		return r.providerFallback(m, req, acc, start, err)
	}
	if err := r.ledger.commit(h, call.InputTokens+call.OutputTokens, call.USD); err != nil {
		acc.add(call)
		return r.budgetStop(m, req, acc, start)
	}
	acc.add(call)
	res := Result{
		RequestID:  req.ID,
		Text:       comp.Text,
		Tier:       TierSmall,
		Confidence: comp.Confidence,
		Reason:     ReasonSmall,
	}
	return r.succeed(m, key, res, acc, start)
}

func (r *Router) providerFallback(m *Machine, req Request, acc *accumulator, start time.Time, cause error) (Result, error) {
	if cause == nil || errors.Is(cause, errNilProvider) || cause.Error() == "provider tier mismatch" {
		return Result{}, cause
	}
	if err := m.Transition(StateDone); err != nil {
		return Result{}, err
	}
	res := Result{
		RequestID: req.ID,
		Text:      fallbackText(req.Task),
		Tier:      TierRules,
		Trace:     m.Trace(),
		Terminal:  StateDone,
		Latency:   time.Since(start),
		Reason:    ReasonFallback,
	}
	if acc != nil {
		res.InputTokens = acc.in
		res.OutputTokens = acc.out
		res.USD = acc.usd
		res.ProviderCalls = acc.calls
	}
	r.finish(res)
	return res, nil
}

func fallbackText(task Task) string {
	switch task {
	case TaskClassify:
		return `{"intent":"UNCLEAR","confidence":0.6,"reasoning":"No strong signal detected; routing to human review.","suggestedAction":"Queue for human review: intent ambiguous."}`
	case TaskExtract:
		return "extract: incomplete; only facts present in the submitted text"
	default:
		return "fallback: needs a human; no model result"
	}
}

func promptLimit(req Request, retry bool) int {
	if req.Task != TaskClassify && req.Task != TaskExtract {
		return 0
	}
	if retry {
		return LowConfidencePromptChars
	}
	return PromptPolicyChars
}

func (r *Router) succeed(m *Machine, key string, res Result, acc *accumulator, start time.Time) (Result, error) {
	if acc != nil {
		res.InputTokens = acc.in
		res.OutputTokens = acc.out
		res.USD = acc.usd
		res.ProviderCalls = acc.calls
	}
	if r.cfg.CacheEnabled {
		r.cache.set(key, stored{text: res.Text, confidence: res.Confidence, tier: res.Tier}, r.now().Add(r.cfg.CacheTTL))
		if err := m.Transition(StateCached); err != nil {
			return Result{}, err
		}
	}
	if err := m.Transition(StateDone); err != nil {
		return Result{}, err
	}
	res.Trace = m.Trace()
	res.Terminal = StateDone
	res.Latency = time.Since(start)
	r.finish(res)
	return res, nil
}

func (r *Router) budgetStop(m *Machine, req Request, acc *accumulator, start time.Time) (Result, error) {
	if err := m.Transition(StateBudgetExceeded); err != nil {
		return Result{}, err
	}
	res := Result{
		RequestID: req.ID,
		Trace:     m.Trace(),
		Terminal:  StateBudgetExceeded,
		Latency:   time.Since(start),
		Reason:    ReasonBudget,
	}
	if acc != nil {
		res.InputTokens = acc.in
		res.OutputTokens = acc.out
		res.USD = acc.usd
		res.ProviderCalls = acc.calls
	}
	r.finish(res)
	return res, ErrBudgetExceeded
}

func (r *Router) finish(res Result) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.metrics = append(r.metrics, CallMetric{
		RequestID:     res.RequestID,
		Tier:          res.Tier,
		Trace:         append([]State(nil), res.Trace...),
		Terminal:      res.Terminal,
		CacheHit:      res.CacheHit,
		InputTokens:   res.InputTokens,
		OutputTokens:  res.OutputTokens,
		Latency:       res.Latency,
		Confidence:    res.Confidence,
		Reason:        res.Reason,
		USD:           res.USD,
		ProviderCalls: append([]ProviderCall(nil), res.ProviderCalls...),
	})
	r.logs = append(r.logs, fmt.Sprintf(
		"route terminal=%s tier=%s cache_hit=%t input_tokens=%d output_tokens=%d latency_us=%d reason=%s",
		res.Terminal, res.Tier, res.CacheHit, res.InputTokens, res.OutputTokens, res.Latency.Microseconds(), res.Reason,
	))
}

func (r *Router) call(ctx context.Context, p Provider, tier Tier, req Request, inputLimit int) (Completion, ProviderCall, error) {
	if p == nil {
		return Completion{}, ProviderCall{}, errNilProvider
	}
	if p.Tier() != tier {
		return Completion{}, ProviderCall{}, errors.New("provider tier mismatch")
	}
	if err := ctx.Err(); err != nil {
		return Completion{}, ProviderCall{}, err
	}
	creq := CompletionRequest{
		Tier:      tier,
		Task:      string(req.Task),
		System:    systemFor(tier),
		Prompt:    buildPrompt(req, tier, inputLimit),
		MaxTokens: r.maxTokens(req, tier),
	}
	comp, lat, err := r.attempt(ctx, p, creq)
	if isTimeout(err) {
		comp, lat, err = r.attempt(ctx, p, creq)
		if isTimeout(err) {
			r.infra.Add(1)
			return Completion{}, ProviderCall{}, ErrInfra
		}
	}
	if err != nil {
		return Completion{}, ProviderCall{}, err
	}
	if comp.InputTokens < 0 || comp.OutputTokens < 0 {
		return Completion{}, ProviderCall{}, errors.New("provider reported negative tokens")
	}
	pc := ProviderCall{
		Tier:         tier,
		InputTokens:  int64(comp.InputTokens),
		OutputTokens: int64(comp.OutputTokens),
		Latency:      lat,
		USD:          costUSD(r.cfg, tier, int64(comp.InputTokens), int64(comp.OutputTokens)),
	}
	return comp, pc, nil
}

func (r *Router) attempt(ctx context.Context, p Provider, req CompletionRequest) (Completion, time.Duration, error) {
	if r.cfg.RouteDeadline > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, r.cfg.RouteDeadline)
		defer cancel()
	}
	return r.completeOnce(ctx, p, req)
}

func (r *Router) completeOnce(ctx context.Context, p Provider, req CompletionRequest) (comp Completion, lat time.Duration, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			r.infra.Add(1)
			panic(ErrInfra)
		}
	}()
	started := time.Now()
	comp, err = p.Complete(ctx, req)
	lat = time.Since(started)
	if err == nil {
		return comp, lat, nil
	}
	if isTimeout(err) {
		return Completion{}, lat, context.DeadlineExceeded
	}
	return Completion{}, lat, errors.New("provider error")
}

func isTimeout(err error) bool {
	return err != nil && errors.Is(err, context.DeadlineExceeded)
}

func (r *Router) tokenEstimate(req Request, tier Tier) (in, out int64) {
	return estimateTokens(systemFor(tier), buildPrompt(req, tier, promptLimit(req, false)), r.maxTokens(req, tier))
}

func (r *Router) maxTokens(req Request, tier Tier) int {
	if req.MaxTokens > 0 {
		return req.MaxTokens
	}
	if tier == TierBig {
		return 1024
	}
	return 256
}

func systemFor(tier Tier) string {
	if tier == TierBig {
		return systemBig
	}
	return systemSmall
}

func buildPrompt(req Request, tier Tier, inputLimit int) string {
	input := req.Input
	if inputLimit > 0 {
		input = trimRunes(input, inputLimit)
	}
	var b strings.Builder
	b.WriteString("task=")
	b.WriteString(string(req.Task))
	b.WriteString("\ninput=")
	b.WriteString(input)
	b.WriteString("\nshortlisted=")
	b.WriteString(strconv.FormatBool(req.Shortlisted))
	if len(req.Fields) > 0 {
		keys := make([]string, 0, len(req.Fields))
		for k := range req.Fields {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			b.WriteByte('\n')
			b.WriteString(k)
			b.WriteByte('=')
			b.WriteString(req.Fields[k])
		}
	}
	b.WriteString("\ntier=")
	b.WriteString(string(tier))
	return b.String()
}

func trimRunes(s string, n int) string {
	runes := []rune(s)
	if n <= 0 || len(runes) <= n {
		return s
	}
	return string(runes[:n])
}

func estimateTokens(system, prompt string, maxTokens int) (in, out int64) {
	in = int64((len(system) + len(prompt)) / 4)
	if in < 1 {
		in = 1
	}
	out = int64(maxTokens)
	if out < 1 {
		out = 1
	}
	return in, out
}

func costUSD(cfg Config, tier Tier, in, out int64) float64 {
	inP, outP := cfg.SmallInputUSDPer1K, cfg.SmallOutputUSDPer1K
	if tier == TierBig {
		inP, outP = cfg.BigInputUSDPer1K, cfg.BigOutputUSDPer1K
	}
	return (float64(in)/1000)*inP + (float64(out)/1000)*outP
}

func confident(c Completion, threshold float64) bool {
	if strings.TrimSpace(c.Text) == "" {
		return false
	}
	if math.IsNaN(c.Confidence) || c.Confidence < 0 || c.Confidence > 1 {
		return false
	}
	return c.Confidence >= threshold
}

type accumulator struct {
	calls []ProviderCall
	in    int64
	out   int64
	usd   float64
}

func (a *accumulator) add(c ProviderCall) {
	a.calls = append(a.calls, c)
	a.in += c.InputTokens
	a.out += c.OutputTokens
	a.usd += c.USD
}

var errNilProvider = errors.New("nil provider")

// InfraErrors counts timeouts that stayed failed after one retry, and
// provider panics that were contained instead of re-panicked.
func (r *Router) InfraErrors() int64 { return r.infra.Load() }
