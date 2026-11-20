// Package audit is the append-only Aria audit log.
package audit

import (
	"errors"
	"sync"
	"time"
)

const (
	// ActionTouch is one outreach touch (mail.message or mail.activity).
	ActionTouch = "outreach.touch"
	// ActionApprovalMirror records that a ledger approval was copied to Odoo.
	ActionApprovalMirror = "approval.mirror"
	// ActionHired records a hire gate that passed.
	ActionHired = "stage.hired"
	// ActionHireRefused records a hire gate that refused.
	ActionHireRefused = "hire.refused"
)

// ErrDuplicate means this idempotency key was already appended.
var ErrDuplicate = errors.New("audit entry already exists")

// Entry is one append-only fact. Detail is a short static description, not a
// message body and not a credential.
type Entry struct {
	ID             int64
	At             time.Time
	Action         string
	IdempotencyKey string
	AriaID         string
	Model          string
	Detail         string
}

// Log rejects updates and deletes. A repeated idempotency key returns the
// original entry and ErrDuplicate.
type Log struct {
	mu    sync.Mutex
	now   func() time.Time
	next  int64
	items []Entry
	byKey map[string]Entry
}

// New returns an empty log. now may be nil.
func New(now func() time.Time) *Log {
	if now == nil {
		now = time.Now
	}
	return &Log{now: now, byKey: map[string]Entry{}}
}

// Append adds an entry. The clock inside the log sets At.
func (l *Log) Append(e Entry) (Entry, error) {
	if e.Action == "" || e.IdempotencyKey == "" {
		return Entry{}, errors.New("audit entry requires an action and an idempotency key")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if prev, ok := l.byKey[e.IdempotencyKey]; ok {
		return prev, ErrDuplicate
	}
	l.next++
	e.ID = l.next
	e.At = l.now().UTC()
	l.items = append(l.items, e)
	l.byKey[e.IdempotencyKey] = e
	return e, nil
}

// Entries returns a copy. Mutating it does not change the log.
func (l *Log) Entries() []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Entry, len(l.items))
	copy(out, l.items)
	return out
}

// ByKey returns the entry for an idempotency key.
func (l *Log) ByKey(key string) (Entry, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.byKey[key]
	return e, ok
}
