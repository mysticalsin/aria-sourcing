package channels

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

const (
	syntheticKey     = "synthetic-approval-key"
	syntheticAPIKey  = "synthetic-heyreach-key"
	adaRecipient     = "ada@example.com"
	lawfulBasis      = "Legitimate interest in recruiting for a synthetic role. Controller: Example Hiring."
	unsubscribeURL   = "https://example.com/unsubscribe/synthetic"
	draftBody        = "Hello Ada, we have a role."
	noticeSentence   = "Notice: GDPR Article 14 and LGPD. You were not the source of this contact data. You may request access, correction, or deletion, and you may object to this use."
	wantDraftHash    = "eeab36fb17ca9bbe49f469155c9122a742d609dd69ea08394308eafd601bbc99"
	wantBindingHash  = "b9976d404aa3454dca5e8adb160efa8a0db27a6ae628af30c7af89b65bd4ebaf"
	wantTokenMAC     = "4224c57889f0b3d6cc5d6efc67943d435b11e70429e6061cc51cbfddcfb8255e"
	wantPreparedHash = "037213146aa485e915acacee5fe9e1ed5a4b568ea38706228187421d8d1ab785"
	heyRecipient     = "conversation-synthetic-1"
	heySender        = "sender-synthetic-1"
)

func tokenKey() []byte { return []byte(syntheticKey) }

func refExpiry() time.Time { return time.Unix(1893456000, 0).UTC() }

func expectedEmailBody() string {
	return draftBody + "\n\n" +
		"Why you are receiving this: " + lawfulBasis + "\n" +
		noticeSentence + "\n" +
		"Unsubscribe: " + unsubscribeURL + "\n"
}

type manualClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *manualClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *manualClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

type memAudit struct {
	mu       sync.Mutex
	msgs     []MailMessage
	err      error
	calls    int
	failFrom int
}

func (m *memAudit) PostChatter(ctx context.Context, msg MailMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.err != nil || (m.failFrom > 0 && m.calls >= m.failFrom) {
		return errors.New("synthetic audit down")
	}
	m.msgs = append(m.msgs, msg)
	return nil
}

func (m *memAudit) snapshot() []MailMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]MailMessage, len(m.msgs))
	copy(out, m.msgs)
	return out
}

type fakeMailer struct {
	mu   sync.Mutex
	sent []OutboundMail
	err  error
}

func (f *fakeMailer) Send(ctx context.Context, mail OutboundMail) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, mail)
	return nil
}

func (f *fakeMailer) snapshot() []OutboundMail {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]OutboundMail, len(f.sent))
	copy(out, f.sent)
	return out
}

func emailDraft() Draft {
	return Draft{
		Channel:        "email",
		Recipient:      "Ada@Example.com",
		Subject:        " A role ",
		Body:           draftBody,
		LawfulBasis:    lawfulBasis,
		UnsubscribeURL: unsubscribeURL,
		SenderID:       "sender-synthetic-1",
		From:           "recruiting@example.com",
	}
}

func emailEnv(extra map[string]string) Environ {
	set := map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST":    "ada@example.com",
		"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
		"ARIA_UNSUBSCRIBE_HOST":       "example.com",
		"ARIA_EMAIL_SENDER_DAILY_CAP": "10",
	}
	for key, value := range extra {
		set[key] = value
	}
	return NewEnviron(set)
}

type emailRig struct {
	email  *Email
	mailer *fakeMailer
	audit  *memAudit
	clock  *manualClock
}

func newEmailRig(tEnv LiveEnv) emailRig {
	mailer := &fakeMailer{}
	audit := &memAudit{}
	clock := &manualClock{now: refExpiry().Add(-time.Hour)}
	return emailRig{
		email: NewEmail(EmailConfig{
			Env:      tEnv,
			TokenKey: tokenKey(),
			SMTP:     mailer,
			Auditor:  audit,
			Clock:    clock,
		}),
		mailer: mailer,
		audit:  audit,
		clock:  clock,
	}
}

func (r emailRig) approved(t interface {
	Helper()
	Fatal(...any)
}, mode CampaignMode) ApprovedMessage {
	t.Helper()
	exact, err := r.email.Prepare(context.Background(), emailDraft())
	if err != nil {
		t.Fatal(err)
	}
	return ApprovedMessage{
		Exact:     exact,
		Token:     mint(t, exact, mode, "recruiting@example.com", 0, r.clock.Now()),
		DeliverTo: "Ada@Example.com",
		From:      "recruiting@example.com",
		SenderID:  "sender-synthetic-1",
		Campaign:  mode,
		Record:    MailRecord{Model: "aria.campaign", ResID: 42, Name: "Synthetic role"},
	}
}

func heyEnv(base string, extra map[string]string) Environ {
	set := map[string]string{
		"ARIA_HEYREACH_ENABLED":           "true",
		"ARIA_RECIPIENT_ALLOWLIST":        heyRecipient,
		"ARIA_SENDER_ALLOWLIST":           "42",
		"ARIA_HEYREACH_SENDER_DAILY_CAP":  "10",
		"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "10",
		"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
		"HEYREACH_BASE_URL":               base,
		"HEYREACH_API_KEY":                syntheticAPIKey,
	}
	for key, value := range extra {
		set[key] = value
	}
	return NewEnviron(set)
}

func heyDraft() Draft {
	return Draft{
		Channel:   "heyreach",
		Recipient: heyRecipient,
		Subject:   "Hello",
		Body:      "Synthetic note for a fictional recipient.",
		SenderID:  heySender,
	}
}

var tokenNonce atomic.Uint64

func mint(t interface {
	Helper()
	Fatal(...any)
}, exact ExactText, mode CampaignMode, from string, account int64, now time.Time) string {
	t.Helper()
	nonce := fmt.Sprintf("nonce-%d", tokenNonce.Add(1))
	tok, err := issueToken(tokenKey(), tokenClaims{
		Exact:           exact,
		UnsubscribeURL:  exact.UnsubscribeURL,
		Mode:            mode.Mode,
		QCPass:          mode.QCPass,
		AutoOptIn:       mode.AutoOptIn,
		From:            from,
		SenderAccountID: account,
		IssuedAt:        now,
		ExpiresAt:       now.Add(time.Hour),
		Nonce:           nonce,
	})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func mustOK(t interface {
	Helper()
	Fatalf(string, ...any)
}, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func mustReason(t interface {
	Helper()
	Fatalf(string, ...any)
}, err, target error) {
	t.Helper()
	if !errors.Is(err, target) {
		t.Fatalf("error = %v, want %v", err, target)
	}
}
