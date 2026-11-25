package interviewer

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

// SignatureHeader is the header a caller reads before AcceptWebhook.
// The value is hex HMAC-SHA256 of the raw body, optionally prefixed with "sha256=".
const SignatureHeader = "X-Interviewer-Signature"

// IdempotencyHeader is sent on every screening create.
const IdempotencyHeader = "Idempotency-Key"

const maxSignatureLen = 200

// VerifySignature reports whether signature is the HMAC-SHA256 of body under secret.
// Comparison uses crypto/subtle.ConstantTimeCompare. An empty secret, a
// malformed encoding, or a length mismatch fails closed.
func VerifySignature(secret string, body []byte, signature string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := mac.Sum(nil)
	if secret == "" || len(signature) > maxSignatureLen {
		subtle.ConstantTimeCompare(expected, expected)
		return false
	}
	sig := strings.TrimSpace(signature)
	sig = strings.TrimPrefix(sig, "sha256=")
	got, err := hex.DecodeString(sig)
	if err != nil || len(got) != len(expected) {
		subtle.ConstantTimeCompare(expected, expected)
		return false
	}
	return subtle.ConstantTimeCompare(expected, got) == 1
}
