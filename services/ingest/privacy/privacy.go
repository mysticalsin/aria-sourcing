// Package privacy is the retention hook for CV bytes and parsed profiles.
//
// The worker schedules a deadline when it keeps raw bytes or a parsed
// profile. PurgeDue asks for what is due and deletes those copies. The
// deadlines are engineering defaults until a DPO sets the real retention;
// they are not a legal determination.
package privacy

import (
	"sync"
	"time"
)

// Kind distinguishes the raw file from the parsed profile.
type Kind string

const (
	KindRaw     Kind = "raw"
	KindProfile Kind = "profile"
)

// Deadline is one scheduled purge. UploadID is the opaque id, not a name.
type Deadline struct {
	UploadID string
	Kind     Kind
	Until    time.Time
}

// Hook records retention deadlines. Cancel drops a deadline that was
// scheduled for an attempt the caller then abandoned.
type Hook interface {
	Schedule(Deadline)
	Due(now time.Time) []Deadline
	MarkPurged(uploadID string, kind Kind, at time.Time)
	Cancel(uploadID string, kind Kind)
}

type item struct {
	Deadline
	purged bool
}

// Memory is the default hook.
type Memory struct {
	mu    sync.Mutex
	items []item
}

// NewMemory returns an empty hook.
func NewMemory() *Memory {
	return &Memory{}
}

// Schedule appends a deadline. A second schedule for the same id and kind
// is ignored so a retry does not extend or duplicate the clock.
func (m *Memory) Schedule(d Deadline) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, it := range m.items {
		if it.UploadID == d.UploadID && it.Kind == d.Kind {
			return
		}
	}
	m.items = append(m.items, item{Deadline: d})
}

// Due lists deadlines whose time has come and that have not been purged
// or cancelled.
func (m *Memory) Due(now time.Time) []Deadline {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Deadline
	for _, it := range m.items {
		if it.purged {
			continue
		}
		if it.Until.After(now) {
			continue
		}
		out = append(out, it.Deadline)
	}
	return out
}

// MarkPurged records that the caller deleted the bytes.
func (m *Memory) MarkPurged(uploadID string, kind Kind, _ time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.items {
		if m.items[i].UploadID == uploadID && m.items[i].Kind == kind {
			m.items[i].purged = true
		}
	}
}

// Cancel removes an unpurged deadline.
func (m *Memory) Cancel(uploadID string, kind Kind) {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := m.items[:0]
	for _, it := range m.items {
		if it.UploadID == uploadID && it.Kind == kind && !it.purged {
			continue
		}
		next = append(next, it)
	}
	m.items = next
}
