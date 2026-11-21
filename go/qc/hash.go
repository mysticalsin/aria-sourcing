package qc

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
)

// DraftHash is the SHA-256 of the exact draft text, as lowercase hex.
// Channel, subject, body, language, and claims are included in that order.
// A one-character edit produces a different hash. An empty result is never
// returned.
func DraftHash(d Draft) string {
	h := sha256.New()
	write := func(s string) {
		b := []byte(s)
		var n [4]byte
		binary.BigEndian.PutUint32(n[:], uint32(len(b)))
		h.Write(n[:])
		h.Write(b)
	}
	write(d.Channel)
	write(d.Subject)
	write(d.Body)
	write(d.Language)
	var count [4]byte
	binary.BigEndian.PutUint32(count[:], uint32(len(d.Claims)))
	h.Write(count[:])
	for _, claim := range d.Claims {
		write(claim.Text)
		write(claim.Scope)
	}
	return hex.EncodeToString(h.Sum(nil))
}
