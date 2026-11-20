package channels

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

const tokenVersion = "v1"

// IssueToken mints the reference approval token the Rust ledger will produce.
// Send only verifies tokens; callers outside tests should not mint them.
func IssueToken(key []byte, exact ExactText, expires time.Time) (string, error) {
	if len(key) < 16 {
		return "", ErrConfig
	}
	normalized, err := normalizeExact(exact, "")
	if err != nil {
		return "", err
	}
	if expires.IsZero() {
		return "", ErrConfig
	}
	material := tokenMaterial(normalized, expires)
	mac := hmacSHA256(key, material)
	return tokenVersion + "." +
		base64.RawURLEncoding.EncodeToString(material) + "." +
		base64.RawURLEncoding.EncodeToString(mac), nil
}

// VerifyToken accepts a token only when its MAC matches, it has not expired,
// and the embedded channel, recipient, subject, and body hash equal exact.
// A token is valid while now < expires.
func VerifyToken(key []byte, token string, exact ExactText, now time.Time) error {
	if len(key) < 16 {
		return ErrToken
	}
	material, mac, err := decodeToken(token)
	if err != nil {
		return ErrToken
	}
	want := hmacSHA256(key, material)
	if !hmac.Equal(mac, want) {
		return ErrToken
	}
	channel, recipient, subject, bodyHash, expires, err := parseMaterial(material)
	if err != nil {
		return ErrToken
	}
	if !now.Before(expires) {
		return ErrExpired
	}
	normalized, err := normalizeExact(exact, "")
	if err != nil {
		return ErrBinding
	}
	if !same(channel, normalized.Channel) ||
		!same(recipient, normalized.Recipient) ||
		!same(subject, normalized.Subject) ||
		!same(bodyHash, normalized.BodyHash) {
		return ErrBinding
	}
	return nil
}

func tokenMaterial(exact ExactText, expires time.Time) []byte {
	expiry := strconv.FormatInt(expires.UTC().Unix(), 10)
	return lengthPrefixed(exact.Channel, exact.Recipient, exact.Subject, exact.BodyHash, expiry)
}

func hmacSHA256(key, material []byte) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(material)
	return mac.Sum(nil)
}

func decodeToken(token string) ([]byte, []byte, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != tokenVersion || parts[1] == "" || parts[2] == "" {
		return nil, nil, ErrToken
	}
	material, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, nil, ErrToken
	}
	mac, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, nil, ErrToken
	}
	return material, mac, nil
}

func parseMaterial(material []byte) (string, string, string, string, time.Time, error) {
	channel, rest, err := readPrefixed(material)
	if err != nil {
		return "", "", "", "", time.Time{}, err
	}
	recipient, rest, err := readPrefixed(rest)
	if err != nil {
		return "", "", "", "", time.Time{}, err
	}
	subject, rest, err := readPrefixed(rest)
	if err != nil {
		return "", "", "", "", time.Time{}, err
	}
	bodyHash, rest, err := readPrefixed(rest)
	if err != nil {
		return "", "", "", "", time.Time{}, err
	}
	expiry, rest, err := readPrefixed(rest)
	if err != nil || len(rest) != 0 {
		return "", "", "", "", time.Time{}, ErrToken
	}
	seconds, err := strconv.ParseInt(expiry, 10, 64)
	if err != nil {
		return "", "", "", "", time.Time{}, ErrToken
	}
	return channel, recipient, subject, bodyHash, time.Unix(seconds, 0).UTC(), nil
}

func same(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return hmac.Equal([]byte(left), []byte(right))
}
