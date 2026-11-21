package source

import (
	"context"
	"sync"
)

// Memory is the in-memory Sink used by tests and by the worker default.
// It is idempotent on IdempotencyKey: a replay replaces the record.
type Memory struct {
	mu    sync.Mutex
	byKey map[string]Record
	order []string
	calls int
}

// NewMemory returns an empty sink.
func NewMemory() *Memory {
	return &Memory{byKey: map[string]Record{}}
}

// UpsertSource stores rec, replacing a previous row with the same key.
func (m *Memory) UpsertSource(_ context.Context, rec Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.byKey == nil {
		m.byKey = map[string]Record{}
	}
	if _, ok := m.byKey[rec.IdempotencyKey]; !ok {
		m.order = append(m.order, rec.IdempotencyKey)
	}
	m.byKey[rec.IdempotencyKey] = cloneRecord(rec)
	m.calls++
	return nil
}

// EraseApplicant blanks the structured person on every row for uploadID and
// leaves the UTM triple in place (the source mapping is not the CV body).
func (m *Memory) EraseApplicant(_ context.Context, uploadID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, rec := range m.byKey {
		if rec.UploadID == uploadID {
			rec.Applicant = Applicant{}
			m.byKey[k] = rec
		}
	}
	return nil
}

// Calls is how many UpsertSource calls ran, including idempotent replays.
func (m *Memory) Calls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

// ByUpload returns the stored record for an upload id.
func (m *Memory) ByUpload(uploadID string) (Record, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, rec := range m.byKey {
		if rec.UploadID == uploadID {
			return cloneRecord(rec), true
		}
	}
	return Record{}, false
}

// Len is the number of distinct idempotency keys.
func (m *Memory) Len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.byKey)
}

func cloneRecord(rec Record) Record {
	rec.Applicant.Skills = append([]string(nil), rec.Applicant.Skills...)
	rec.Applicant.Languages = append([]string(nil), rec.Applicant.Languages...)
	rec.Applicant.Experience = append([]Role(nil), rec.Applicant.Experience...)
	return rec
}
