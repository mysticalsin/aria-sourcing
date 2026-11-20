package channels

import (
	"fmt"
	"sync"
	"time"
)

type senderLimits struct {
	mu     sync.Mutex
	daily  map[string]int
	weekly map[string]int
	last   map[string]time.Time
	paused map[string]struct{}
}

func newSenderLimits() *senderLimits {
	return &senderLimits{
		daily:  map[string]int{},
		weekly: map[string]int{},
		last:   map[string]time.Time{},
		paused: map[string]struct{}{},
	}
}

func (s *senderLimits) reserve(sender string, now time.Time, dailyCap, weeklyCap int, gap time.Duration, pauseKeys []string) (func(bool), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.isPaused(append(pauseKeys, senderKey(sender))...) {
		return nil, ErrPaused
	}
	if gap > 0 {
		if last, ok := s.last[sender]; ok && now.Sub(last) < gap {
			return nil, ErrPacing
		}
	}
	dayKey := sender + ":" + now.UTC().Format("2006-01-02")
	year, week := now.UTC().ISOWeek()
	weekKey := fmt.Sprintf("%s:%04d-W%02d", sender, year, week)
	if dailyCap <= 0 || s.daily[dayKey] >= dailyCap {
		return nil, ErrDailyCap
	}
	if weeklyCap > 0 && s.weekly[weekKey] >= weeklyCap {
		return nil, ErrWeeklyCap
	}
	s.daily[dayKey]++
	if weeklyCap > 0 {
		s.weekly[weekKey]++
	}
	return func(commit bool) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if commit {
			s.last[sender] = now
			return
		}
		if s.daily[dayKey] > 0 {
			s.daily[dayKey]--
		}
		if weeklyCap > 0 && s.weekly[weekKey] > 0 {
			s.weekly[weekKey]--
		}
	}, nil
}

func (s *senderLimits) pause(keys ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, key := range keys {
		if key != "" {
			s.paused[key] = struct{}{}
		}
	}
}

func (s *senderLimits) isPaused(keys ...string) bool {
	for _, key := range keys {
		if _, ok := s.paused[key]; ok {
			return true
		}
	}
	return false
}

func senderKey(sender string) string { return "sender:" + sender }

func accountKey(account int64) string {
	return fmt.Sprintf("acct:%d", account)
}
