package channels

import "sync"

// LiveEnv is read on every Send. A map copied at construction is not enough
// for the kill switch.
type LiveEnv interface {
	Lookup(key string) (string, bool)
}

// LiveMap is a mutable LiveEnv. Adapters that keep the pointer see Set.
type LiveMap struct {
	mu   sync.RWMutex
	vars map[string]string
}

// NewLiveEnv returns a mutable environment. Set is visible to later Send calls
// on adapters that hold this pointer.
func NewLiveEnv(initial map[string]string) *LiveMap {
	vars := make(map[string]string, len(initial))
	for key, value := range initial {
		vars[key] = value
	}
	return &LiveMap{vars: vars}
}

func (e *LiveMap) Lookup(key string) (string, bool) {
	if e == nil {
		return "", false
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	value, ok := e.vars[key]
	return value, ok
}

// Set changes one variable for later reads.
func (e *LiveMap) Set(key, value string) {
	if e == nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.vars == nil {
		e.vars = map[string]string{}
	}
	e.vars[key] = value
}

func lookup(env LiveEnv, key string) (string, bool) {
	if env == nil {
		return "", false
	}
	return env.Lookup(key)
}
