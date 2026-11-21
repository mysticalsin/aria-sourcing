// Package qc is the outreach quality-control gate.
//
// Evaluate is a pure function from a draft, candidate facts, and need facts
// to a Verdict. It does not send mail, call a network, read the clock, or
// import the approval ledger. The ledger may depend on Verdict later; this
// package does not depend on the ledger.
//
// A PASS requires every check to pass and a score at or above the caller's
// threshold. ARIA_QC_PASS_THRESHOLD (default 0.9) is read only by
// ThresholdFrom and LoadThreshold. Lowering the threshold cannot waive a
// failed check.
//
// Length limits are Unicode code points. InMail and HeyReach caps are the
// constants in limits.go, each with the vendor page they were taken from.
package qc
