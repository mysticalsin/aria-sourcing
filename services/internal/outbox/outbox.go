// Package outbox stores the result of an Aria write so a retry replays it.
//
// The box is process-local. It is not durable across restarts. Odoo rows are
// read back from Odoo (or the fake JSON-2 server), not from this box. The box
// only remembers the first result of a key, and it keeps at most MaxEntries
// results. When the cap is reached, the oldest key is dropped.
package outbox

import (
	"encoding/json"
	"errors"
	"sync"
)

// MaxEntries is the cap on stored results.
const MaxEntries = 1024

// Box is an in-memory Aria outbox. The first stored result for a key wins.
type Box struct {
	mu    sync.Mutex
	items map[string][]byte
	order []string
}

// New returns an empty outbox.
func New() *Box {
	return &Box{items: map[string][]byte{}}
}

// Load copies the stored result into dest. dest may be nil when the caller
// only needs to know whether the key exists.
func (b *Box) Load(key string, dest any) (bool, error) {
	if key == "" {
		return false, errors.New("outbox key is required")
	}
	b.mu.Lock()
	raw, ok := b.items[key]
	b.mu.Unlock()
	if !ok {
		return false, nil
	}
	if dest == nil {
		return true, nil
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return true, err
	}
	return true, nil
}

// Store keeps the first result for key and ignores later writes.
func (b *Box) Store(key string, v any) error {
	if key == "" {
		return errors.New("outbox key is required")
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.items[key]; ok {
		return nil
	}
	if len(b.items) >= MaxEntries && len(b.order) > 0 {
		oldest := b.order[0]
		b.order = b.order[1:]
		delete(b.items, oldest)
	}
	b.items[key] = raw
	b.order = append(b.order, key)
	return nil
}

// Len returns the number of stored keys.
func (b *Box) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.items)
}
