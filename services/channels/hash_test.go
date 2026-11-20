package channels

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestBodyHashLengthPrefixedGolden(t *testing.T) {
	if got := BodyHash(draftBody); got != wantDraftHash {
		t.Fatalf("BodyHash = %s, want %s", got, wantDraftHash)
	}
}

func TestBindingHashCoversChannelRecipientSubjectAndBodyHash(t *testing.T) {
	if got := BindingHash("email", adaRecipient, "A role", wantDraftHash); got != wantBindingHash {
		t.Fatalf("BindingHash = %s, want %s", got, wantBindingHash)
	}
	if BindingHash("email", adaRecipient, "A role", wantDraftHash) == BindingHash("emai", "l"+adaRecipient, "A role", wantDraftHash) {
		t.Fatal("length prefix did not separate channel and recipient")
	}
	if BindingHash("ab", "c", "subj", "hash") == BindingHash("a", "bc", "subj", "hash") {
		t.Fatal("length prefix collided on adjacent fields")
	}
}

func TestIssueTokenMatchesReferenceMAC(t *testing.T) {
	exact := ExactText{
		Channel:   "email",
		Recipient: adaRecipient,
		Subject:   "A role",
		Body:      draftBody,
		BodyHash:  wantDraftHash,
	}
	tok, err := IssueToken(tokenKey(), exact, refExpiry())
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 || parts[0] != "v1" || parts[1] == "" || parts[2] == "" {
		t.Fatalf("token = %q, want v1.<material>.<mac>", tok)
	}
	mac, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(mac) != wantTokenMAC {
		t.Fatalf("mac = %s, want %s", hex.EncodeToString(mac), wantTokenMAC)
	}
	if err := VerifyToken(tokenKey(), tok, exact, refExpiry().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyTokenRefusesExpiryTamperAndWrongKey(t *testing.T) {
	exact := ExactText{
		Channel:   "Email",
		Recipient: "Ada@Example.com",
		Subject:   " A role ",
		Body:      draftBody,
		BodyHash:  wantDraftHash,
	}
	tok, err := IssueToken(tokenKey(), exact, refExpiry())
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyToken(tokenKey(), tok, exact, refExpiry()); !errors.Is(err, ErrExpired) {
		t.Fatalf("at expiry: %v", err)
	}
	if err := VerifyToken(tokenKey(), tok, exact, refExpiry().Add(-time.Nanosecond)); err != nil {
		t.Fatalf("before expiry: %v", err)
	}
	other := exact
	other.Body = draftBody + "!"
	other.BodyHash = ""
	if err := VerifyToken(tokenKey(), tok, other, refExpiry().Add(-time.Second)); !errors.Is(err, ErrBinding) {
		t.Fatalf("tampered body: %v", err)
	}
	swapped := exact
	swapped.Recipient = "bea@example.com"
	if err := VerifyToken(tokenKey(), tok, swapped, refExpiry().Add(-time.Second)); !errors.Is(err, ErrBinding) {
		t.Fatalf("tampered recipient: %v", err)
	}
	if err := VerifyToken([]byte("another-synthetic-key"), tok, exact, refExpiry().Add(-time.Second)); !errors.Is(err, ErrToken) {
		t.Fatalf("wrong key: %v", err)
	}
	flipped := partsFlip(t, tok)
	if err := VerifyToken(tokenKey(), flipped, exact, refExpiry().Add(-time.Second)); !errors.Is(err, ErrToken) {
		t.Fatalf("flipped mac: %v", err)
	}
	if err := VerifyToken(tokenKey(), "", exact, refExpiry().Add(-time.Second)); !errors.Is(err, ErrToken) {
		t.Fatalf("empty token: %v", err)
	}
}

func partsFlip(t *testing.T, token string) string {
	t.Helper()
	parts := strings.Split(token, ".")
	mac, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	mac[0] ^= 0x01
	parts[2] = base64.RawURLEncoding.EncodeToString(mac)
	return strings.Join(parts, ".")
}
