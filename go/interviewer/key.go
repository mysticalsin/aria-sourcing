package interviewer

import (
	"crypto/sha256"
	"encoding/binary"
)

// symbolAlphabet is disjoint from [a-z0-9] so a digest cannot contain a
// candidate, need, or approval id as a substring. The characters are HTTP
// token characters, safe in an Idempotency-Key header.
// Sixteen HTTP-token symbols, one per nibble, none of them [a-z0-9].
const symbolAlphabet = "!#$%&'*+-.^_`|~="

func init() {
	if len(symbolAlphabet) != 16 {
		panic("interviewer: symbol alphabet must encode one nibble")
	}
}

// IdempotencyKey is a stable digest of the candidate, the need, and the
// recorded approval. Length prefixes stop ("a","bb","c") colliding with
// ("ab","b","c"). The raw ids are not recoverable from the key.
func IdempotencyKey(candidateID, needID, approvalID string) string {
	h := sha256.New()
	for _, part := range []string{candidateID, needID, approvalID} {
		var buf [8]byte
		binary.BigEndian.PutUint64(buf[:], uint64(len(part)))
		_, _ = h.Write(buf[:])
		_, _ = h.Write([]byte(part))
	}
	sum := h.Sum(nil)
	out := make([]byte, len(sum)*2)
	for i, b := range sum {
		out[i*2] = symbolAlphabet[b>>4]
		out[i*2+1] = symbolAlphabet[b&0x0f]
	}
	return string(out)
}
