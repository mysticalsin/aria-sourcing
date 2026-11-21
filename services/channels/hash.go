package channels

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
)

// BodyHash is the lowercase hex SHA-256 of the length-prefixed UTF-8 body.
// The length is an 8-byte big-endian count, so two different splits of the
// same bytes do not share a digest.
func BodyHash(body string) string {
	sum := sha256.Sum256(lengthPrefixed(body))
	return hex.EncodeToString(sum[:])
}

// BindingHash is the lowercase hex SHA-256 of the length-prefixed channel,
// recipient, subject, and body hash. It is the value an approval token binds.
func BindingHash(channel, recipient, subject, bodyHash string) string {
	sum := sha256.Sum256(lengthPrefixed(channel, recipient, subject, bodyHash))
	return hex.EncodeToString(sum[:])
}

func lengthPrefixed(parts ...string) []byte {
	size := 0
	for _, part := range parts {
		size += 8 + len(part)
	}
	buf := make([]byte, 0, size)
	var prefix [8]byte
	for _, part := range parts {
		binary.BigEndian.PutUint64(prefix[:], uint64(len(part)))
		buf = append(buf, prefix[:]...)
		buf = append(buf, part...)
	}
	return buf
}

func readPrefixed(in []byte) (string, []byte, error) {
	if len(in) < 8 {
		return "", nil, ErrToken
	}
	n := binary.BigEndian.Uint64(in[:8])
	if n > 1<<20 {
		return "", nil, ErrToken
	}
	in = in[8:]
	if uint64(len(in)) < n {
		return "", nil, ErrToken
	}
	return string(in[:n]), in[n:], nil
}
