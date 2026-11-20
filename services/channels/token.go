package channels

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

const (
	tokenVersion = "v1"
	// MaxTokenLifetime is the longest interval a ledger token may cover.
	MaxTokenLifetime = 24 * time.Hour
	// ClockSkew is how far a peer clock may disagree before a token is refused.
	ClockSkew = 2 * time.Minute
)

// tokenClaims is the reference payload the Rust ledger mints. This package
// verifies tokens. It does not export a mint function.
type tokenClaims struct {
	Exact           ExactText
	UnsubscribeURL  string
	Mode            string
	QCPass          bool
	AutoOptIn       bool
	From            string
	SenderAccountID int64
	IssuedAt        time.Time
	ExpiresAt       time.Time
	Nonce           string
}

type boundFields struct {
	exact          ExactText
	unsubscribeURL string
	mode           string
	qcPass         bool
	autoOptIn      bool
	from           string
	accountID      int64
}

func issueToken(key []byte, claims tokenClaims) (string, error) {
	if len(key) < 16 {
		return "", ErrConfig
	}
	normalized, err := normalizeExact(claims.Exact, "")
	if err != nil {
		return "", err
	}
	mode, err := canonicalMode(claims.Mode)
	if err != nil {
		return "", err
	}
	from, err := canonicalFrom(claims.From)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(claims.Nonce) == "" || strings.ContainsAny(claims.Nonce, "\r\n \t") {
		return "", ErrConfig
	}
	if claims.IssuedAt.IsZero() || claims.ExpiresAt.IsZero() || !claims.ExpiresAt.After(claims.IssuedAt) {
		return "", ErrConfig
	}
	if claims.ExpiresAt.Sub(claims.IssuedAt) > MaxTokenLifetime {
		return "", ErrConfig
	}
	claims.Exact = normalized
	claims.Mode = mode
	claims.From = from
	material := tokenMaterial(claims)
	mac := hmacSHA256(key, material)
	return tokenVersion + "." +
		base64.RawURLEncoding.EncodeToString(material) + "." +
		base64.RawURLEncoding.EncodeToString(mac), nil
}

func verifyToken(key []byte, token string, want boundFields, now time.Time) (string, error) {
	if len(key) < 16 {
		return "", ErrToken
	}
	material, mac, err := decodeToken(token)
	if err != nil {
		return "", ErrToken
	}
	if !hmac.Equal(mac, hmacSHA256(key, material)) {
		return "", ErrToken
	}
	claims, err := parseMaterial(material)
	if err != nil {
		return "", ErrToken
	}
	if !claims.ExpiresAt.After(claims.IssuedAt) || claims.ExpiresAt.Sub(claims.IssuedAt) > MaxTokenLifetime {
		return "", ErrToken
	}
	if claims.IssuedAt.After(now.Add(ClockSkew)) {
		return "", ErrToken
	}
	if !now.Before(claims.ExpiresAt.Add(ClockSkew)) {
		return "", ErrExpired
	}
	normalized, err := normalizeExact(want.exact, "")
	if err != nil {
		return "", ErrBinding
	}
	mode, err := canonicalMode(want.mode)
	if err != nil {
		return "", ErrBinding
	}
	from, err := canonicalFrom(want.from)
	if err != nil {
		return "", ErrBinding
	}
	if !same(claims.Exact.Channel, normalized.Channel) ||
		!same(claims.Exact.Recipient, normalized.Recipient) ||
		!same(claims.Exact.Subject, normalized.Subject) ||
		!same(claims.Exact.BodyHash, normalized.BodyHash) ||
		!same(claims.UnsubscribeURL, want.unsubscribeURL) ||
		!same(claims.Mode, mode) ||
		claims.QCPass != want.qcPass ||
		claims.AutoOptIn != want.autoOptIn ||
		!same(claims.From, from) ||
		claims.SenderAccountID != want.accountID {
		return "", ErrBinding
	}
	return claims.Nonce, nil
}

func tokenMaterial(claims tokenClaims) []byte {
	return lengthPrefixed(
		claims.Exact.Channel,
		claims.Exact.Recipient,
		claims.Exact.Subject,
		claims.Exact.BodyHash,
		claims.UnsubscribeURL,
		claims.Mode,
		bit(claims.QCPass),
		bit(claims.AutoOptIn),
		claims.From,
		strconv.FormatInt(claims.SenderAccountID, 10),
		strconv.FormatInt(claims.IssuedAt.UTC().Unix(), 10),
		strconv.FormatInt(claims.ExpiresAt.UTC().Unix(), 10),
		claims.Nonce,
	)
}

func bit(v bool) string {
	if v {
		return "1"
	}
	return "0"
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

func parseMaterial(material []byte) (tokenClaims, error) {
	var claims tokenClaims
	var rest = material
	var err error
	read := func() string {
		if err != nil {
			return ""
		}
		var part string
		part, rest, err = readPrefixed(rest)
		return part
	}
	claims.Exact.Channel = read()
	claims.Exact.Recipient = read()
	claims.Exact.Subject = read()
	claims.Exact.BodyHash = read()
	claims.UnsubscribeURL = read()
	claims.Mode = read()
	qc := read()
	auto := read()
	claims.From = read()
	account := read()
	iat := read()
	exp := read()
	claims.Nonce = read()
	if err != nil || len(rest) != 0 {
		return tokenClaims{}, ErrToken
	}
	claims.QCPass, err = parseBit(qc)
	if err != nil {
		return tokenClaims{}, ErrToken
	}
	claims.AutoOptIn, err = parseBit(auto)
	if err != nil {
		return tokenClaims{}, ErrToken
	}
	claims.SenderAccountID, err = strconv.ParseInt(account, 10, 64)
	if err != nil {
		return tokenClaims{}, ErrToken
	}
	issued, err := strconv.ParseInt(iat, 10, 64)
	if err != nil {
		return tokenClaims{}, ErrToken
	}
	expires, err := strconv.ParseInt(exp, 10, 64)
	if err != nil {
		return tokenClaims{}, ErrToken
	}
	claims.IssuedAt = time.Unix(issued, 0).UTC()
	claims.ExpiresAt = time.Unix(expires, 0).UTC()
	return claims, nil
}

func parseBit(raw string) (bool, error) {
	switch raw {
	case "1":
		return true, nil
	case "0":
		return false, nil
	default:
		return false, ErrToken
	}
}

func canonicalMode(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "manual":
		return "manual", nil
	case "auto":
		return "auto", nil
	default:
		return "", ErrMode
	}
}

func canonicalFrom(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	return CanonicalRecipient(raw)
}

func same(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return hmac.Equal([]byte(left), []byte(right))
}
