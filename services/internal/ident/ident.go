// Package ident checks caller-supplied ids before they are stored or logged.
package ident

import (
	"errors"
	"regexp"
)

// ErrInvalid means the value is empty, too long, or not a safe token.
var ErrInvalid = errors.New("identifier is invalid")

var token = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`)

// Safe reports whether s is a short token that can be stored and logged.
// It rejects the internal key prefixes used by the ledger and the hire gate.
func Safe(s string, max int) error {
	if s == "" || len(s) > max || !token.MatchString(s) {
		return ErrInvalid
	}
	switch {
	case hasPrefix(s, "approval."), hasPrefix(s, "stage."), hasPrefix(s, "hire."):
		return ErrInvalid
	default:
		return nil
	}
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
