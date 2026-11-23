package channels

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUnsetRecipientAllowlistDenies(t *testing.T) {
	env := NewEnviron(map[string]string{
		"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
		"ARIA_UNSUBSCRIBE_HOST":       "example.com",
		"ARIA_EMAIL_SENDER_DAILY_CAP": "10",
	})
	if _, ok := env.Lookup("ARIA_RECIPIENT_ALLOWLIST"); ok {
		t.Fatal("the allowlist key must be absent")
	}
	rig := newEmailRig(env)
	_, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{}))
	if !errors.Is(err, ErrAllowlist) {
		t.Fatalf("unset allowlist: %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("unset allowlist delivered mail")
	}
}

func TestCanonicalRecipientRejectsIncompleteAddresses(t *testing.T) {
	for _, raw := range []string{"ada@", "not-an-email", "ada@example", "@example.com", "ada@@example.com"} {
		if _, err := CanonicalRecipient(raw); err == nil {
			t.Fatalf("CanonicalRecipient(%q) accepted an invalid recipient", raw)
		}
	}
	got, err := CanonicalRecipient("Ada@Example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != "ada@example.com" {
		t.Fatalf("canonical = %q", got)
	}
}

func TestNilHeyReachClientRefusesNetwork(t *testing.T) {
	client := (&HeyReach{}).client()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:1/api/public/inbox/SendMessage", nil)
	_, err := client.Transport.RoundTrip(req)
	if !errors.Is(err, ErrConfig) {
		t.Fatalf("nil client transport dialed or returned %v", err)
	}
}
