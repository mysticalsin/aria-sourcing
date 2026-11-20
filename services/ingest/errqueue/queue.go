// Package errqueue is Toast's sourcing-error queue: one row per failed
// upload, with a reason code and the folder the recruiter picked.
// Rows do not carry the CV body.
package errqueue

import (
	"sync"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

// Item is one sourcing error. Field names are part of the queue contract.
type Item struct {
	UploadID    string
	Reason      state.Reason
	RootReason  state.Reason
	Attempts    int
	Retryable   bool
	CVSource    string
	JobBoard    string
	Folder      string
	FolderValue string
	DocType     string
	FailedAt    time.Time
}

// Queue is an in-memory sourcing-error queue. Upsert replaces the row for
// an upload id and keeps its original position.
type Queue struct {
	mu    sync.Mutex
	items map[string]Item
	order []string
}

// New returns an empty queue.
func New() *Queue {
	return &Queue{items: map[string]Item{}}
}

// Upsert inserts or replaces the row for item.UploadID.
func (q *Queue) Upsert(item Item) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.items == nil {
		q.items = map[string]Item{}
	}
	if _, ok := q.items[item.UploadID]; !ok {
		q.order = append(q.order, item.UploadID)
	}
	q.items[item.UploadID] = item
}

// Remove drops a row after a successful retry.
func (q *Queue) Remove(uploadID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if _, ok := q.items[uploadID]; !ok {
		return
	}
	delete(q.items, uploadID)
	next := q.order[:0]
	for _, id := range q.order {
		if id != uploadID {
			next = append(next, id)
		}
	}
	q.order = next
}

// Get returns a copy of one row.
func (q *Queue) Get(uploadID string) (Item, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	item, ok := q.items[uploadID]
	return item, ok
}

// List returns the rows in first-seen order.
func (q *Queue) List() []Item {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]Item, 0, len(q.order))
	for _, id := range q.order {
		out = append(out, q.items[id])
	}
	return out
}
