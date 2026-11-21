package channels

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestEmailTimeoutLeavesOutcomeUnknown(t *testing.T) {
	mailer := &blockingMailer{}
	clock := &manualClock{now: refExpiry().Add(-time.Hour)}
	env := emailEnv(map[string]string{"ARIA_EMAIL_SENDER_DAILY_CAP": "1"})
	email := NewEmail(EmailConfig{
		Env: env, TokenKey: tokenKey(), SMTP: mailer, Auditor: &memAudit{}, Clock: clock,
	})
	exact, err := email.Prepare(context.Background(), emailDraft())
	if err != nil {
		t.Fatal(err)
	}
	msg := ApprovedMessage{
		Exact: exact, Token: mint(t, exact, CampaignMode{}, "recruiting@example.com", 0, clock.Now()),
		DeliverTo: adaRecipient, From: "recruiting@example.com", SenderID: "sender-synthetic-1",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if _, err := email.Send(ctx, msg); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("timeout outcome: %v", err)
	}
	if _, err := email.Send(context.Background(), msg); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("retry of unknown token: %v", err)
	}
	if got := atomic.LoadInt32(&mailer.calls); got != 1 {
		t.Fatalf("smtp calls = %d, want 1", got)
	}
	other := msg
	other.Token = mint(t, exact, CampaignMode{}, other.From, 0, clock.Now())
	if _, err := email.Send(context.Background(), other); !errors.Is(err, ErrDailyCap) {
		t.Fatalf("fresh token should see the held cap: %v", err)
	}
}

func TestHeyReachStatusDecidesTokenAndCap(t *testing.T) {
	cases := []struct {
		status       int
		releaseToken bool
	}{
		{http.StatusBadRequest, true},
		{http.StatusRequestTimeout, false},
		{http.StatusInternalServerError, false},
		{http.StatusServiceUnavailable, false},
	}
	for _, tc := range cases {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			var hits int32
			srv := newHeyServer(tc.status, `{"errorMessage":"synthetic outcome"}`)
			srv.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&hits, 1)
				if n == 1 {
					w.WriteHeader(tc.status)
					_, _ = io.WriteString(w, `{"errorMessage":"synthetic outcome"}`)
					return
				}
				w.WriteHeader(http.StatusOK)
				_, _ = io.WriteString(w, `{"ok":true}`)
			})
			defer srv.srv.Close()
			clock := &manualClock{now: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)}
			ch, err := newHeyReachForTest(HeyReachConfig{
				Env: heyEnv(srv.srv.URL, map[string]string{
					"ARIA_HEYREACH_SENDER_DAILY_CAP":  "1",
					"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "5",
					"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
				}),
				TokenKey: tokenKey(),
				Auditor:  &memAudit{},
				Clock:    clock,
				HTTP:     srv.srv.Client(),
			})
			if err != nil {
				t.Fatal(err)
			}
			exact, err := ch.Prepare(context.Background(), heyDraft())
			if err != nil {
				t.Fatal(err)
			}
			msg := ApprovedMessage{
				Exact: exact, Token: mint(t, exact, CampaignMode{}, "", 42, clock.Now()),
				DeliverTo: heyRecipient, SenderID: heySender, SenderAccountID: 42,
			}
			_, err = ch.Send(context.Background(), msg)
			if tc.releaseToken {
				if err == nil || errors.Is(err, ErrOutcomeUnknown) {
					t.Fatalf("definite refusal: %v", err)
				}
				if _, err := ch.Send(context.Background(), msg); err != nil {
					t.Fatalf("retry after refusal: %v", err)
				}
				if atomic.LoadInt32(&hits) != 2 {
					t.Fatalf("hits = %d, want 2", hits)
				}
				return
			}
			if !errors.Is(err, ErrOutcomeUnknown) {
				t.Fatalf("unknown outcome: %v", err)
			}
			if _, err := ch.Send(context.Background(), msg); !errors.Is(err, ErrOutcomeUnknown) {
				t.Fatalf("retry of unknown token: %v", err)
			}
			fresh := msg
			fresh.Token = mint(t, exact, CampaignMode{}, "", 42, clock.Now())
			if _, err := ch.Send(context.Background(), fresh); !errors.Is(err, ErrDailyCap) {
				t.Fatalf("fresh token should see the held cap: %v", err)
			}
			if atomic.LoadInt32(&hits) != 1 {
				t.Fatalf("hits = %d, want 1", hits)
			}
		})
	}
}

func TestHeyReachClientTimeoutLeavesOutcomeUnknown(t *testing.T) {
	var hits int32
	srv := newHeyServer(http.StatusOK, `{"ok":true}`)
	srv.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		time.Sleep(500 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	})
	defer srv.srv.Close()
	client := srv.srv.Client()
	client.Timeout = 80 * time.Millisecond
	clock := &manualClock{now: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)}
	ch, err := newHeyReachForTest(HeyReachConfig{
		Env: heyEnv(srv.srv.URL, map[string]string{
			"ARIA_HEYREACH_SENDER_DAILY_CAP":  "1",
			"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "5",
			"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
		}),
		TokenKey: tokenKey(),
		Auditor:  &memAudit{},
		Clock:    clock,
		HTTP:     client,
	})
	if err != nil {
		t.Fatal(err)
	}
	exact, err := ch.Prepare(context.Background(), heyDraft())
	if err != nil {
		t.Fatal(err)
	}
	msg := ApprovedMessage{
		Exact: exact, Token: mint(t, exact, CampaignMode{}, "", 42, clock.Now()),
		DeliverTo: heyRecipient, SenderID: heySender, SenderAccountID: 42,
	}
	if _, err := ch.Send(context.Background(), msg); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("client timeout: %v", err)
	}
	if _, err := ch.Send(context.Background(), msg); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("retry of unknown token: %v", err)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("hits = %d, want 1", hits)
	}
}

func TestHeyReachWarningBoundsParallelSends(t *testing.T) {
	var hits int32
	srv := newHeyServer(http.StatusForbidden, `{"errorMessage":"Account warning: sender restricted"}`)
	srv.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		time.Sleep(40 * time.Millisecond)
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"errorMessage":"Account warning: sender restricted"}`)
	})
	defer srv.srv.Close()
	clock := &manualClock{now: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)}
	ch, err := newHeyReachForTest(HeyReachConfig{
		Env: heyEnv(srv.srv.URL, map[string]string{
			"ARIA_HEYREACH_SENDER_DAILY_CAP":  "20",
			"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "20",
			"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
		}),
		TokenKey: tokenKey(),
		Auditor:  &memAudit{},
		Clock:    clock,
		HTTP:     srv.srv.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	exact, err := ch.Prepare(context.Background(), heyDraft())
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			msg := ApprovedMessage{
				Exact: exact, Token: mint(t, exact, CampaignMode{}, "", 42, clock.Now()),
				DeliverTo: heyRecipient, SenderID: heySender, SenderAccountID: 42,
			}
			_, _ = ch.Send(context.Background(), msg)
		}()
	}
	wg.Wait()
	if got := atomic.LoadInt32(&hits); got > 1 {
		t.Fatalf("provider hits = %d, want at most 1", got)
	}
}

type blockingMailer struct {
	calls int32
}

func (b *blockingMailer) Send(ctx context.Context, mail OutboundMail) error {
	atomic.AddInt32(&b.calls, 1)
	<-ctx.Done()
	return ctx.Err()
}
