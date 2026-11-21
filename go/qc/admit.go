package qc

// Admit is the send boundary. The red gate allows any PASS through and does
// not re-check channel caps.
func Admit(draft Draft, v Verdict) error {
	_ = draft
	if v == nil || v.Status() != StatusPass {
		return ErrVerdict
	}
	return nil
}
