// Package ledger is Aria's approval authority.
//
// An approval is an append-only row bound to the SHA-256 of the exact
// channel, recipient, subject, body, and notice version. Odoo can store a
// copy of that fact. It cannot insert a row here.
package ledger

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrOdooCannotGrantApproval is returned for every attempt to approve from an
// Odoo record, note, or activity.
var ErrOdooCannotGrantApproval = errors.New("odoo records cannot grant approval")

// ErrValidation means the approval request is incomplete.
var ErrValidation = errors.New("approval request is invalid")

// Request is the exact text a person in Aria approved.
type Request struct {
	Channel         string
	RecipientRef    string
	Subject         string
	Body            string
	NoticeVersion   string
	Approver        string
	ApplicantAriaID string
}

// Approval is one ledger row.
type Approval struct {
	ID              int64
	Channel         string
	RecipientRef    string
	Subject         string
	Body            string
	NoticeVersion   string
	Approver        string
	ApplicantAriaID string
	Hash            string
	At              time.Time
}

// Ledger is append-only. The only writer that grants approval is Approve.
type Ledger struct {
	mu     sync.Mutex
	now    func() time.Time
	next   int64
	items  []Approval
	byHash map[string]Approval
}

// New returns an empty ledger. now may be nil.
func New(now func() time.Time) *Ledger {
	if now == nil {
		now = time.Now
	}
	return &Ledger{now: now, byHash: map[string]Approval{}}
}

// Hash is SHA-256 of the canonical approval preimage.
// Layout, also documented in docs/approval-hash.md:
//
//	aria-approval-v1, a NUL byte, then each field as a big-endian uint64
//	byte length plus the raw field bytes.
//
// Field order: channel, recipient ref, subject, body, notice version,
// applicant id. Bytes are not trimmed or case-folded. The applicant id is
// part of the preimage so a grant for one applicant cannot authorize another.
func Hash(channel, recipient, subject, body, noticeVersion, applicantID string) string {
	h := sha256.New()
	h.Write([]byte("aria-approval-v1"))
	h.Write([]byte{0})
	for _, part := range []string{channel, recipient, subject, body, noticeVersion, applicantID} {
		var n [8]byte
		binary.BigEndian.PutUint64(n[:], uint64(len(part)))
		h.Write(n[:])
		h.Write([]byte(part))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Approve appends a row, or returns the existing row when the hash is already
// present. Calling it twice does not create a second grant.
func (l *Ledger) Approve(in Request) (Approval, error) {
	if err := validate(in); err != nil {
		return Approval{}, err
	}
	sum := Hash(in.Channel, in.RecipientRef, in.Subject, in.Body, in.NoticeVersion, in.ApplicantAriaID)
	l.mu.Lock()
	defer l.mu.Unlock()
	if prev, ok := l.byHash[sum]; ok {
		return prev, nil
	}
	l.next++
	row := Approval{
		ID:              l.next,
		Channel:         in.Channel,
		RecipientRef:    in.RecipientRef,
		Subject:         in.Subject,
		Body:            in.Body,
		NoticeVersion:   in.NoticeVersion,
		Approver:        in.Approver,
		ApplicantAriaID: in.ApplicantAriaID,
		Hash:            sum,
		At:              l.now().UTC(),
	}
	l.items = append(l.items, row)
	l.byHash[sum] = row
	return row, nil
}

// Has reports whether hash was granted by Approve.
func (l *Ledger) Has(hash string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	_, ok := l.byHash[hash]
	return ok
}

// List returns a copy of the grants, oldest first.
func (l *Ledger) List() []Approval {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Approval, len(l.items))
	copy(out, l.items)
	return out
}

// GrantFromOdoo never inserts a row. note is ignored on purpose: a chatter
// copy, even one that contains a real hash, is not an approval.
func (l *Ledger) GrantFromOdoo(note string) error {
	_ = note
	return ErrOdooCannotGrantApproval
}

func validate(in Request) error {
	if in.Channel == "" || in.RecipientRef == "" || in.Subject == "" || in.Body == "" || in.NoticeVersion == "" || in.Approver == "" {
		return fmt.Errorf("%w: channel, recipient, subject, body, notice version, and approver are required", ErrValidation)
	}
	return nil
}
