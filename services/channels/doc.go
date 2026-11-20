// Package channels is the outreach delivery boundary for Aria.
//
// Prepare freezes the exact text a recipient would see. Send delivers that
// text only after the approval token, kill switch, recipient allowlist, and
// send mode all agree. The approval token is verified here and will be issued
// by the Rust ledger once that ledger lands; this package does not decide
// that a human approved anything.
//
// Nothing in this package dials a mailbox provider or the HeyReach public API
// on its own behalf during tests. Email delivery is an injected Mailer.
// HeyReach delivery uses HEYREACH_BASE_URL and refuses to follow redirects.
package channels
