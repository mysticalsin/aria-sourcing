package router

import (
	"context"
	"sync/atomic"
)

// Tier names the component that produced a decision.
type Tier string

const (
	TierRules Tier = "rules"
	TierSmall Tier = "small"
	TierBig   Tier = "big"
	TierCache Tier = "cache"
)

// CompletionRequest is what a provider sees. It carries no credentials.
type CompletionRequest struct {
	Tier      Tier
	Task      string
	System    string
	Prompt    string
	MaxTokens int
}

// Completion is a provider result. Confidence is in [0, 1]. Token counts
// are the usage the ledger bills.
type Completion struct {
	Text         string
	Confidence   float64
	InputTokens  int
	OutputTokens int
}

// Provider is the model backend. Implementations in this module are fakes:
// they do not dial out and they do not accept an API key.
type Provider interface {
	Tier() Tier
	Complete(ctx context.Context, req CompletionRequest) (Completion, error)
}

// FakeProvider is an in-process model. A nil completion function returns a
// deterministic stub result sized inside the caller's token estimate.
type FakeProvider struct {
	tier  Tier
	fn    func(context.Context, CompletionRequest) (Completion, error)
	calls atomic.Int64
}

// NewFakeProvider builds a fake for tier. fn may be nil.
func NewFakeProvider(tier Tier, fn func(context.Context, CompletionRequest) (Completion, error)) *FakeProvider {
	return &FakeProvider{tier: tier, fn: fn}
}

// Tier returns the tier this fake stands in for.
func (p *FakeProvider) Tier() Tier { return p.tier }

// Calls is how many times Complete was entered.
func (p *FakeProvider) Calls() int64 { return p.calls.Load() }

// Complete runs the stub. It does not touch the network.
func (p *FakeProvider) Complete(ctx context.Context, req CompletionRequest) (Completion, error) {
	if p == nil {
		return Completion{}, errNilProvider
	}
	p.calls.Add(1)
	if err := ctx.Err(); err != nil {
		return Completion{}, err
	}
	if p.fn != nil {
		return p.fn(ctx, req)
	}
	return defaultCompletion(p.tier, req), nil
}

func defaultCompletion(tier Tier, req CompletionRequest) Completion {
	in, _ := estimateTokens(req.System, req.Prompt, req.MaxTokens)
	out := 16
	if req.MaxTokens > 0 && out > req.MaxTokens {
		out = req.MaxTokens
	}
	if out < 1 {
		out = 1
	}
	conf := 0.93
	text := "small: ok"
	if tier == TierBig {
		conf = 0.95
		text = "big: ok"
	}
	return Completion{
		Text:         text,
		Confidence:   conf,
		InputTokens:  int(in),
		OutputTokens: out,
	}
}
