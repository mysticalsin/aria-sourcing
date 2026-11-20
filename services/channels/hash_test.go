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

func goldenClaims() tokenClaims {
	return tokenClaims{
		Exact: ExactText{
			Channel:   "email",
			Recipient: adaRecipient,
			Subject:   "A role",
			Body:      draftBody,
			BodyHash:  wantDraftHash,
		},
		UnsubscribeURL:  unsubscribeURL,
		Mode:            "manual",
		From:            "recruiting@example.com",
		SenderAccountID: 0,
		IssuedAt:        refExpiry().Add(-time.Hour),
		ExpiresAt:       refExpiry(),
		Nonce:           "nonce-synthetic-1",
	}
}

func TestIssueTokenMatchesReferenceMAC(t *testing.T) {
	claims := goldenClaims()
	tok, err := issueToken(tokenKey(), claims)
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
	if hex.EncodeToString(mac) != referenceMAC() {
		t.Fatalf("mac = %s, want %s", hex.EncodeToString(mac), referenceMAC())
	}
	if _, err := verifyToken(tokenKey(), tok, boundOf(claims), refExpiry().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyTokenRefusesExpiryTamperAndWrongKey(t *testing.T) {
	claims := goldenClaims()
	claims.Exact.Channel = "Email"
	claims.Exact.Recipient = "Ada@Example.com"
	claims.Exact.Subject = " A role "
	tok, err := issueToken(tokenKey(), claims)
	if err != nil {
		t.Fatal(err)
	}
	now := refExpiry().Add(-time.Second)
	if _, err := verifyToken(tokenKey(), tok, boundOf(claims), refExpiry().Add(ClockSkew)); !errors.Is(err, ErrExpired) {
		t.Fatalf("beyond skew: %v", err)
	}
	if _, err := verifyToken(tokenKey(), tok, boundOf(claims), refExpiry().Add(30*time.Second)); err != nil {
		t.Fatalf("inside skew: %v", err)
	}
	tampered := claims.Exact
	tampered.Body = draftBody + "!"
	tampered.BodyHash = ""
	want := boundOf(claims)
	want.exact = tampered
	if _, err := verifyToken(tokenKey(), tok, want, now); !errors.Is(err, ErrBinding) {
		t.Fatalf("tampered body: %v", err)
	}
	want = boundOf(claims)
	want.exact.Recipient = "bea@example.com"
	if _, err := verifyToken(tokenKey(), tok, want, now); !errors.Is(err, ErrBinding) {
		t.Fatalf("tampered recipient: %v", err)
	}
	if _, err := verifyToken([]byte("another-synthetic-key"), tok, boundOf(claims), now); !errors.Is(err, ErrToken) {
		t.Fatalf("wrong key: %v", err)
	}
	if _, err := verifyToken(tokenKey(), partsFlip(t, tok), boundOf(claims), now); !errors.Is(err, ErrToken) {
		t.Fatalf("flipped mac: %v", err)
	}
	if _, err := verifyToken(tokenKey(), "", boundOf(claims), now); !errors.Is(err, ErrToken) {
		t.Fatalf("empty token: %v", err)
	}
}

func TestTokenLifetimeAndClockSkew(t *testing.T) {
	now := refExpiry()
	tooLong := goldenClaims()
	tooLong.IssuedAt = now
	tooLong.ExpiresAt = now.Add(MaxTokenLifetime + time.Second)
	tooLong.Nonce = "nonce-too-long"
	if _, err := issueToken(tokenKey(), tooLong); !errors.Is(err, ErrConfig) {
		t.Fatalf("over-long lifetime: %v", err)
	}
	future := goldenClaims()
	future.IssuedAt = now.Add(10 * time.Minute)
	future.ExpiresAt = future.IssuedAt.Add(time.Hour)
	future.Nonce = "nonce-future"
	tok, err := issueToken(tokenKey(), future)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyToken(tokenKey(), tok, boundOf(future), now); !errors.Is(err, ErrToken) {
		t.Fatalf("far future issue: %v", err)
	}
	near := goldenClaims()
	near.IssuedAt = now.Add(30 * time.Second)
	near.ExpiresAt = near.IssuedAt.Add(time.Hour)
	near.Nonce = "nonce-near"
	tok, err = issueToken(tokenKey(), near)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyToken(tokenKey(), tok, boundOf(near), now); err != nil {
		t.Fatalf("skew allows a near-future issue time: %v", err)
	}
}

func referenceMAC() string {
	return strings.Join([]string{
		"4224c578",
		"89f0b3d6",
		"cc5d6efc",
		"67943d43",
		"5b11e704",
		"29e6061c",
		"c51cbfdd",
		"cfb8255e",
	}, "")
}

func boundOf(claims tokenClaims) boundFields {
	return boundFields{
		exact:          claims.Exact,
		unsubscribeURL: claims.UnsubscribeURL,
		mode:           claims.Mode,
		qcPass:         claims.QCPass,
		autoOptIn:      claims.AutoOptIn,
		from:           claims.From,
		accountID:      claims.SenderAccountID,
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
