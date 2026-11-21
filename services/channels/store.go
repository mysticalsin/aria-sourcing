package channels

import (
	"context"
	"sync"
	"time"
)

// ConsumedStore records approval-token nonces. A database or the Rust ledger
// can implement it. Consume must be safe for concurrent callers.
type ConsumedStore interface {
	Consume(ctx context.Context, nonce string) error
}

// PauseStore records sender pauses for a database or Odoo-backed implementation.
// A zero until means the pause stays until Resume. Resume is the human clear.
type PauseStore interface {
	Pause(ctx context.Context, key string, until time.Time, reason string) error
	Paused(ctx context.Context, key string, now time.Time) (bool, error)
	Resume(ctx context.Context, key string) error
	NoteFailure(ctx context.Context, key string, now time.Time, window time.Duration) (int, error)
}

// MemoryConsumedStore is the in-process nonce ledger.
type MemoryConsumedStore struct {
	mu   sync.Mutex
	used map[string]struct{}
}

// NewMemoryConsumedStore returns an empty in-memory nonce store.
func NewMemoryConsumedStore() *MemoryConsumedStore {
	return &MemoryConsumedStore{used: map[string]struct{}{}}
}

// Consume accepts a nonce once.
func (s *MemoryConsumedStore) Consume(ctx context.Context, nonce string) error {
	if s == nil {
		return ErrConfig
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	if nonce == "" {
		return ErrToken
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.used[nonce]; ok {
		return ErrTokenUsed
	}
	s.used[nonce] = struct{}{}
	return nil
}

type pauseRecord struct {
	until  time.Time
	reason string
}

// MemoryPauseStore is the in-process pause and error-rate ledger.
type MemoryPauseStore struct {
	mu       sync.Mutex
	pauses   map[string]pauseRecord
	failures map[string][]time.Time
}

// NewMemoryPauseStore returns an empty in-memory pause store.
func NewMemoryPauseStore() *MemoryPauseStore {
	return &MemoryPauseStore{
		pauses:   map[string]pauseRecord{},
		failures: map[string][]time.Time{},
	}
}

// Pause records a pause. An existing open-ended pause is left in place.
func (s *MemoryPauseStore) Pause(ctx context.Context, key string, until time.Time, reason string) error {
	if s == nil {
		return ErrConfig
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	if key == "" {
		return ErrConfig
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.pauses[key]; ok && existing.until.IsZero() {
		return nil
	}
	s.pauses[key] = pauseRecord{until: until, reason: reason}
	return nil
}

// Resume clears one pause. A human takes this action.
func (s *MemoryPauseStore) Resume(ctx context.Context, key string) error {
	if s == nil {
		return ErrConfig
	}
	if err := ctxErr(ctx); err != nil {
		return err
	}
	if key == "" {
		return ErrConfig
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.pauses, key)
	return nil
}

// Paused reports whether key is paused at now. A zero until does not expire.
func (s *MemoryPauseStore) Paused(ctx context.Context, key string, now time.Time) (bool, error) {
	if s == nil {
		return true, ErrConfig
	}
	if err := ctxErr(ctx); err != nil {
		return true, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.pauses[key]
	if !ok {
		return false, nil
	}
	if record.until.IsZero() || now.Before(record.until) {
		return true, nil
	}
	return false, nil
}

// NoteFailure stores one failure and returns how many fall inside the window.
func (s *MemoryPauseStore) NoteFailure(ctx context.Context, key string, now time.Time, window time.Duration) (int, error) {
	if s == nil {
		return 0, ErrConfig
	}
	if err := ctxErr(ctx); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cut := now.Add(-window)
	kept := make([]time.Time, 0, len(s.failures[key])+1)
	for _, at := range s.failures[key] {
		if !at.Before(cut) {
			kept = append(kept, at)
		}
	}
	kept = append(kept, now)
	s.failures[key] = kept
	return len(kept), nil
}
