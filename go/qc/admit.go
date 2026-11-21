package qc

import "fmt"

// Admit is the send boundary. A send may proceed only when the verdict is a
// PASS bound to this exact draft and the draft still fits the channel caps.
// The cap check runs here as well as inside Evaluate.
func Admit(draft Draft, v Verdict) error {
	if v == nil {
		return ErrVerdict
	}
	if v.DraftHash() == "" || v.DraftHash() != DraftHash(draft) {
		return ErrStaleVerdict
	}
	if v.Status() != StatusPass || v.QCVersion() != QCVersion {
		return ErrVerdict
	}
	length := checkLength(draft)
	if !length.pass {
		return fmt.Errorf("%w: %s", ErrCaps, length.detail)
	}
	return nil
}
