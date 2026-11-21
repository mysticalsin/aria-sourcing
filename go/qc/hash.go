package qc

// DraftHash is the identity of the exact draft text a verdict is bound to.
// The red gate returns an empty hash. A verdict with an empty hash is not
// bound to any draft.
func DraftHash(Draft) string { return "" }
