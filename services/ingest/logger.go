package ingest

import (
	"sync"

	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

// Log event operations. These are the only free strings a log line carries,
// and each one is a fixed token.
const (
	OpTransition   = "transition"
	OpPurgeRaw     = "purge_raw"
	OpPurgeProfile = "purge_profile"
)

// LogEvent is the only record the worker emits. It has no text, body, or
// contact fields: CV content cannot be logged through this type.
type LogEvent struct {
	UploadID string
	From     state.State
	To       state.State
	Reason   state.Reason
	Bytes    int
	Attempt  int
	Op       string
}

// Logger receives pipeline events. Implementations must print LogEvent and
// nothing else about the upload.
type Logger interface {
	Log(LogEvent)
}

// NopLogger discards events.
type NopLogger struct{}

// Log implements Logger.
func (NopLogger) Log(LogEvent) {}

// SliceLogger keeps events for tests.
type SliceLogger struct {
	mu     sync.Mutex
	events []LogEvent
}

// Log implements Logger.
func (s *SliceLogger) Log(e LogEvent) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.events = append(s.events, e)
	s.mu.Unlock()
}

// Snapshot returns a copy of the events so far.
func (s *SliceLogger) Snapshot() []LogEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]LogEvent, len(s.events))
	copy(out, s.events)
	return out
}
