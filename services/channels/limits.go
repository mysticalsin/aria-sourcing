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
}

func newSenderLimits() *senderLimits {
	return &senderLimits{
		daily:  map[string]int{},
		weekly: map[string]int{},
		last:   map[string]time.Time{},
	}
}

// reserve claims the cap and the pacing slot before the transport runs.
// The returned function rolls both back when commit is false.
func (s *senderLimits) reserve(sender string, now time.Time, dailyCap, weeklyCap int, gap time.Duration) (func(bool), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	previous, hadPrevious := s.last[sender]
	s.daily[dayKey]++
	if weeklyCap > 0 {
		s.weekly[weekKey]++
	}
	s.last[sender] = now
	return func(commit bool) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if commit {
			return
		}
		if s.daily[dayKey] > 0 {
			s.daily[dayKey]--
		}
		if weeklyCap > 0 && s.weekly[weekKey] > 0 {
			s.weekly[weekKey]--
		}
		if hadPrevious {
			s.last[sender] = previous
		} else {
			delete(s.last, sender)
		}
	}, nil
}

func senderKey(sender string) string { return "sender:" + sender }

func accountKey(account int64) string {
	return fmt.Sprintf("acct:%d", account)
}
