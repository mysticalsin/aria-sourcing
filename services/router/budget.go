package router

import (
	"errors"
	"math"
	"sync"
	"time"
)

// ErrBudgetExceeded is returned when a model call would pass a per-run,
// daily, or monthly token ceiling, or a daily or monthly USD ceiling.
// The provider is not called. Rules and cache hits do not spend budget.
var ErrBudgetExceeded = errors.New("budget exceeded")

// ErrInfra is a timeout or provider failure after the allowed retry.
// The text never includes a key or a provider payload.
var ErrInfra = errors.New("infra error")

// Usage is committed model spend. Cache hits and rule hits add nothing.
type Usage struct {
	RunTokens     int64
	DailyTokens   int64
	MonthlyTokens int64
	DailyUSD      float64
	MonthlyUSD    float64
}

type hold struct {
	tokens int64
	usd    float64
	epoch  uint64
}

type ledger struct {
	mu sync.Mutex

	runID    string
	runEpoch uint64

	runTokens     int64
	dailyTokens   int64
	monthlyTokens int64
	dailyUSD      float64
	monthlyUSD    float64

	reservedRun     int64
	reservedDaily   int64
	reservedMonthly int64
	reservedDayUSD  float64
	reservedMonUSD  float64

	day   string
	month string

	runLimit      int64
	dailyLimit    int64
	monthlyLimit  int64
	dailyUSDLim   float64
	monthlyUSDLim float64
}

func newLedger(cfg Config) *ledger {
	return &ledger{
		runLimit:      cfg.RunTokenBudget,
		dailyLimit:    cfg.DailyTokenBudget,
		monthlyLimit:  cfg.MonthlyTokenBudget,
		dailyUSDLim:   cfg.DailyBudgetUSD,
		monthlyUSDLim: cfg.MonthlyBudgetUSD,
	}
}

func (l *ledger) beginRun(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.runID = id
	l.runEpoch++
	l.runTokens = 0
}

func (l *ledger) setTokenLimits(run, daily, monthly int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.runLimit = run
	l.dailyLimit = daily
	l.monthlyLimit = monthly
}

func (l *ledger) setUSDLimits(daily, monthly float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.dailyUSDLim = daily
	l.monthlyUSDLim = monthly
}

func (l *ledger) usage() Usage {
	l.mu.Lock()
	defer l.mu.Unlock()
	return Usage{
		RunTokens:     l.runTokens,
		DailyTokens:   l.dailyTokens,
		MonthlyTokens: l.monthlyTokens,
		DailyUSD:      l.dailyUSD,
		MonthlyUSD:    l.monthlyUSD,
	}
}

func (l *ledger) tryReserve(now time.Time, tokens int64, usd float64) (hold, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.roll(now)
	if tokens < 0 || usd < 0 || math.IsNaN(usd) || math.IsInf(usd, 0) {
		return hold{}, errors.New("invalid reservation")
	}
	if !tokenFits(l.runTokens, l.reservedRun, tokens, l.runLimit) ||
		!tokenFits(l.dailyTokens, l.reservedDaily, tokens, l.dailyLimit) ||
		!tokenFits(l.monthlyTokens, l.reservedMonthly, tokens, l.monthlyLimit) ||
		!usdFits(l.dailyUSD, l.reservedDayUSD, usd, l.dailyUSDLim) ||
		!usdFits(l.monthlyUSD, l.reservedMonUSD, usd, l.monthlyUSDLim) {
		return hold{}, ErrBudgetExceeded
	}
	l.reservedRun += tokens
	l.reservedDaily += tokens
	l.reservedMonthly += tokens
	l.reservedDayUSD += usd
	l.reservedMonUSD += usd
	return hold{tokens: tokens, usd: usd, epoch: l.runEpoch}, nil
}

func (l *ledger) commit(h hold, tokens int64, usd float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.release(h)
	if tokens < 0 {
		tokens = 0
	}
	if usd < 0 || math.IsNaN(usd) || math.IsInf(usd, 0) {
		usd = 0
	}
	if h.epoch == l.runEpoch {
		l.runTokens += tokens
	}
	l.dailyTokens += tokens
	l.monthlyTokens += tokens
	l.dailyUSD += usd
	l.monthlyUSD += usd
}

func (l *ledger) cancel(h hold) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.release(h)
}

func (l *ledger) release(h hold) {
	l.reservedRun = subFloor(l.reservedRun, h.tokens)
	l.reservedDaily = subFloor(l.reservedDaily, h.tokens)
	l.reservedMonthly = subFloor(l.reservedMonthly, h.tokens)
	l.reservedDayUSD = subFloorF(l.reservedDayUSD, h.usd)
	l.reservedMonUSD = subFloorF(l.reservedMonUSD, h.usd)
}

func (l *ledger) roll(now time.Time) {
	day := now.UTC().Format("2006-01-02")
	month := now.UTC().Format("2006-01")
	if l.day == "" {
		l.day = day
		l.month = month
		return
	}
	if day != l.day {
		l.day = day
		l.dailyTokens = 0
		l.dailyUSD = 0
	}
	if month != l.month {
		l.month = month
		l.monthlyTokens = 0
		l.monthlyUSD = 0
	}
}

func tokenFits(used, reserved, add, limit int64) bool {
	if add < 0 || used < 0 || reserved < 0 || limit < 0 {
		return false
	}
	if used > limit {
		return false
	}
	room := limit - used
	if reserved > room {
		return false
	}
	room -= reserved
	return add <= room
}

func usdFits(used, reserved, add, limit float64) bool {
	if math.IsNaN(used) || math.IsNaN(reserved) || math.IsNaN(add) || math.IsNaN(limit) {
		return false
	}
	if math.IsInf(used, 0) || math.IsInf(reserved, 0) || math.IsInf(add, 0) || math.IsInf(limit, 0) {
		return false
	}
	if add < 0 || used < 0 || reserved < 0 || limit < 0 {
		return false
	}
	return used+reserved+add <= limit
}

func subFloor(v, n int64) int64 {
	v -= n
	if v < 0 {
		return 0
	}
	return v
}

func subFloorF(v, n float64) float64 {
	v -= n
	if v < 0 || math.IsNaN(v) {
		return 0
	}
	return v
}
