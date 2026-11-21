// Package outbox stores the result of an Aria write so a retry replays it.
package outbox

import (
	"encoding/json"
	"errors"
	"sync"
)

// Box is an in-memory Aria outbox. The first stored result for a key wins.
type Box struct {
	mu    sync.Mutex
	items map[string][]byte
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
	b.items[key] = raw
	return nil
}

// Len returns the number of stored keys.
func (b *Box) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.items)
}
