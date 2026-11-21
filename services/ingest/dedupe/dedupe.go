// Package dedupe is the duplicate-detection hook the ingest worker calls
// after a CV is parsed and before it is marked ready_for_to_rate.
//
// The default implementation is in-memory. A later Rust dedupe core can
// implement Hook without the worker changing. The fingerprint is the
// normalized email when there is one, otherwise the phone, otherwise the
// name. Empty keys are not indexed, so two identity-less parses cannot
// collapse into each other.
package dedupe

import (
	"context"
	"strings"
	"sync"
	"unicode"
)

// Fingerprint is the identity the hook compares. UploadID is the caller's
// opaque id, used so a retry of the same upload is not its own duplicate.
type Fingerprint struct {
	UploadID string
	Email    string
	Phone    string
	Name     string
}

// Match is a previous upload with the same fingerprint.
type Match struct {
	UploadID string
}

// Hook observes one parsed CV. A nil match means this is the first time
// that fingerprint has been seen (or it is the same upload id).
type Hook interface {
	Observe(ctx context.Context, fp Fingerprint) (*Match, error)
}

// Memory is a process-local hook.
type Memory struct {
	mu      sync.Mutex
	byEmail map[string]string
	byPhone map[string]string
	byName  map[string]string
	calls   int
}

// NewMemory returns an empty hook.
func NewMemory() *Memory {
	return &Memory{
		byEmail: map[string]string{},
		byPhone: map[string]string{},
		byName:  map[string]string{},
	}
}

// Calls is how many times Observe has run.
func (m *Memory) Calls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

// Observe implements Hook.
func (m *Memory) Observe(_ context.Context, fp Fingerprint) (*Match, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	email := normEmail(fp.Email)
	phone := normPhone(fp.Phone)
	name := normName(fp.Name)
	switch {
	case email != "":
		return m.take(m.byEmail, email, fp.UploadID), nil
	case phone != "":
		return m.take(m.byPhone, phone, fp.UploadID), nil
	case name != "":
		return m.take(m.byName, name, fp.UploadID), nil
	default:
		return nil, nil
	}
}

func (m *Memory) take(index map[string]string, key, id string) *Match {
	if prev, ok := index[key]; ok {
		if prev == id {
			return nil
		}
		return &Match{UploadID: prev}
	}
	index[key] = id
	return nil
}

func normEmail(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func normPhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == '+' && b.Len() == 0 {
			b.WriteRune(r)
			continue
		}
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func normName(s string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || r == '-' || r == '\'' {
			b.WriteRune(r)
			space = false
			continue
		}
		if unicode.IsSpace(r) && b.Len() > 0 && !space {
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}
