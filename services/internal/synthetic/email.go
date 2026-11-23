// Package synthetic accepts only reserved example.test addresses.
package synthetic

import (
	"errors"
	"strings"
)

// ErrEmail means the address is not a synthetic *.example.test mailbox.
var ErrEmail = errors.New("email must be a synthetic example.test address")

// Normalize trims and lowercases s and accepts only mailboxes on example.test.
// Real domains, including lookalikes such as notexample.test, are refused.
func Normalize(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	local, host, ok := strings.Cut(s, "@")
	if !ok || strings.Contains(s[len(local)+1:], "@") {
		return "", ErrEmail
	}
	if !localOK(local) || !hostOK(host) {
		return "", ErrEmail
	}
	return local + "@" + host, nil
}

func localOK(s string) bool {
	if s == "" || len(s) > 64 || strings.Contains(s, "..") {
		return false
	}
	if s[0] == '.' || s[len(s)-1] == '.' {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.', r == '_', r == '+', r == '-':
		default:
			return false
		}
	}
	return true
}

func hostOK(s string) bool {
	if s != "example.test" && !strings.HasSuffix(s, ".example.test") {
		return false
	}
	if len(s) > 253 || strings.Contains(s, "..") {
		return false
	}
	for _, label := range strings.Split(s, ".") {
		if label == "" || len(label) > 63 {
			return false
		}
		if label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, r := range label {
			switch {
			case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			default:
				return false
			}
		}
	}
	return true
}
