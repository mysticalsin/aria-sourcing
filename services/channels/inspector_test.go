package channels

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestSecondLabelDoesNotBypassMailboxCapOrGap(t *testing.T) {
	env := NewLiveEnv(map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST":    adaRecipient,
		"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com,other@example.com",
		"ARIA_UNSUBSCRIBE_HOST":       "example.com",
		"ARIA_EMAIL_SENDER_DAILY_CAP": "1",
	})
	rig := newEmailRig(env)
	first := rig.approved(t, CampaignMode{})
	if _, err := rig.email.Send(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	second := first
	second.SenderID = "sender-synthetic-2"
	second.Token = mint(t, second.Exact, second.Campaign, second.From, 0, rig.clock.Now())
	if _, err := rig.email.Send(context.Background(), second); !errors.Is(err, ErrDailyCap) {
		t.Fatalf("second label on the same mailbox: %v", err)
	}
	if len(rig.mailer.snapshot()) != 1 {
		t.Fatalf("delivered %d, want 1", len(rig.mailer.snapshot()))
	}
	other := second
	other.From = "other@example.com"
	other.Token = mint(t, other.Exact, other.Campaign, other.From, 0, rig.clock.Now())
	if _, err := rig.email.Send(context.Background(), other); err != nil {
		t.Fatalf("a different mailbox should have its own cap: %v", err)
	}

	rigHR := newHeyRig(map[string]string{
		"ARIA_SENDER_ALLOWLIST":           "42,99",
		"ARIA_HEYREACH_SENDER_DAILY_CAP":  "5",
		"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "5",
		"ARIA_HEYREACH_MIN_GAP_SECONDS":   "90",
	}, 200, `{"ok":true}`)
	defer rigHR.http.srv.Close()
	msg := rigHR.approved(t, CampaignMode{})
	if _, err := rigHR.ch.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	relabel := msg
	relabel.SenderID = "seat-other-label"
	relabel.Token = mint(t, relabel.Exact, relabel.Campaign, "", 42, rigHR.clock.Now())
	if _, err := rigHR.ch.Send(context.Background(), relabel); !errors.Is(err, ErrPacing) {
		t.Fatalf("second label inside the gap: %v", err)
	}
	if rigHR.http.count() != 1 {
		t.Fatalf("heyreach calls = %d, want 1", rigHR.http.count())
	}
	mismatch := msg
	mismatch.SenderAccountID = 99
	mismatch.Token = mint(t, mismatch.Exact, mismatch.Campaign, "", 42, rigHR.clock.Now())
	if _, err := rigHR.ch.Send(context.Background(), mismatch); !errors.Is(err, ErrBinding) {
		t.Fatalf("account mismatch: %v", err)
	}
}

func TestChatterFollowsTokenVerification(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	msg := rig.approved(t, CampaignMode{})
	msg.Token = "not-a-token"
	if _, err := rig.email.Send(context.Background(), msg); err == nil {
		t.Fatal("invalid token was accepted")
	}
	for _, note := range rig.audit.snapshot() {
		if strings.Contains(note.Body, "outcome=authorized") {
			t.Fatal("chatter recorded authorized before the token was verified")
		}
	}
}

func TestNonPositiveDailyCapGuard(t *testing.T) {
	env := NewLiveEnv(map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST":    adaRecipient,
		"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
		"ARIA_UNSUBSCRIBE_HOST":       "example.com",
		"ARIA_EMAIL_SENDER_DAILY_CAP": "0",
	})
	rig := newEmailRig(env)
	msg := rig.approved(t, CampaignMode{})
	if _, err := rig.email.Send(context.Background(), msg); !errors.Is(err, ErrDailyCap) {
		t.Fatalf("zero cap: %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("zero cap delivered mail")
	}
	env.Set("ARIA_EMAIL_SENDER_DAILY_CAP", "1")
	if _, err := rig.email.Send(context.Background(), msg); err != nil {
		t.Fatalf("token should survive a non-positive cap refusal: %v", err)
	}
}

func TestPositiveDailyCapExhaustionGuard(t *testing.T) {
	rig := newEmailRig(emailEnv(map[string]string{"ARIA_EMAIL_SENDER_DAILY_CAP": "1"}))
	first := rig.approved(t, CampaignMode{})
	if _, err := rig.email.Send(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	second := first
	second.Token = mint(t, second.Exact, second.Campaign, second.From, 0, rig.clock.Now())
	if _, err := rig.email.Send(context.Background(), second); !errors.Is(err, ErrDailyCap) {
		t.Fatalf("second accepted send: %v", err)
	}
	if len(rig.mailer.snapshot()) != 1 {
		t.Fatalf("delivered %d", len(rig.mailer.snapshot()))
	}
}
