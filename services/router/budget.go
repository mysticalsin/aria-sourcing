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

	// tripped sticks after a bill exceeds the reservation and the ceiling.
	// Later calls stay blocked even if a later estimate would look cheap.
	tripped bool

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
	if l.tripped {
		return hold{}, ErrBudgetExceeded
	}
	if tokens < 0 {
		return hold{}, errors.New("invalid reservation")
	}
	if usd < 0 {
		return hold{}, errors.New("invalid reservation")
	}
	if math.IsNaN(usd) {
		return hold{}, errors.New("invalid reservation")
	}
	if math.IsInf(usd, 0) {
		return hold{}, errors.New("invalid reservation")
	}
	runOK := tokenFits(l.runTokens, l.reservedRun, tokens, l.runLimit)
	dailyOK := tokenFits(l.dailyTokens, l.reservedDaily, tokens, l.dailyLimit)
	monthOK := tokenFits(l.monthlyTokens, l.reservedMonthly, tokens, l.monthlyLimit)
	dayUSDOK := usdFits(l.dailyUSD, l.reservedDayUSD, usd, l.dailyUSDLim)
	monthUSDOK := usdFits(l.monthlyUSD, l.reservedMonUSD, usd, l.monthlyUSDLim)
	if !runOK || !dailyOK || !monthOK || !dayUSDOK || !monthUSDOK {
		return hold{}, ErrBudgetExceeded
	}
	l.reservedRun += tokens
	l.reservedDaily += tokens
	l.reservedMonthly += tokens
	l.reservedDayUSD += usd
	l.reservedMonUSD += usd
	return hold{tokens: tokens, usd: usd, epoch: l.runEpoch}, nil
}

func (l *ledger) commit(h hold, tokens int64, usd float64) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.release(h)
	if tokens < 0 {
		tokens = 0
	}
	if usd < 0 {
		usd = 0
	}
	if math.IsNaN(usd) {
		usd = 0
	}
	if math.IsInf(usd, 0) {
		usd = 0
	}
	tokenOver := tokens > h.tokens
	usdOver := usd > h.usd
	over := tokenOver || usdOver
	exceeds := !l.spendFits(h, tokens, usd)
	l.apply(h, tokens, usd)
	if over && exceeds {
		l.tripped = true
		return ErrBudgetExceeded
	}
	return nil
}

func (l *ledger) apply(h hold, tokens int64, usd float64) {
	if h.epoch == l.runEpoch {
		l.runTokens += tokens
	}
	l.dailyTokens += tokens
	l.monthlyTokens += tokens
	l.dailyUSD += usd
	l.monthlyUSD += usd
}

// spendFits re-checks the ceiling after the reservation has been released.
func (l *ledger) spendFits(h hold, tokens int64, usd float64) bool {
	runAdd := tokens
	if h.epoch != l.runEpoch {
		runAdd = 0
	}
	runOK := tokenFits(l.runTokens, 0, runAdd, l.runLimit)
	dailyOK := tokenFits(l.dailyTokens, 0, tokens, l.dailyLimit)
	monthOK := tokenFits(l.monthlyTokens, 0, tokens, l.monthlyLimit)
	dayUSDOK := usdFits(l.dailyUSD, 0, usd, l.dailyUSDLim)
	monthUSDOK := usdFits(l.monthlyUSD, 0, usd, l.monthlyUSDLim)
	return runOK && dailyOK && monthOK && dayUSDOK && monthUSDOK
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
	if add < 0 {
		return false
	}
	if used < 0 {
		return false
	}
	if reserved < 0 {
		return false
	}
	if limit == 0 {
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
	if math.IsNaN(used) {
		return false
	}
	if math.IsInf(used, 0) {
		return false
	}
	if math.IsNaN(reserved) {
		return false
	}
	if math.IsInf(reserved, 0) {
		return false
	}
	if math.IsNaN(add) {
		return false
	}
	if math.IsInf(add, 0) {
		return false
	}
	if math.IsNaN(limit) {
		return false
	}
	if math.IsInf(limit, 0) {
		return false
	}
	if add < 0 {
		return false
	}
	if used < 0 {
		return false
	}
	if reserved < 0 {
		return false
	}
	if limit == 0 {
		return false
	}
	return used+reserved+add <= limit
}

func subFloor(v, n int64) int64 {
	return max(v-n, 0)
}

func subFloorF(v, n float64) float64 {
	d := v - n
	if math.IsNaN(d) {
		return 0
	}
	return math.Max(0, d)
}
