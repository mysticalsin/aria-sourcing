// Package channels is the outreach delivery boundary for Aria.
//
// Prepare freezes the exact text a recipient would see. Send delivers that
// text only after the approval token, kill switch, recipient allowlist, and
// send mode all agree. Tokens are minted by the Rust ledger. This package
// verifies them and does not export a mint function.
//
// Email delivery is an injected SMTP port. HeyReach reaches LinkedIn only
// through HeyReach's official public API, and that adapter stays off unless
// ARIA_HEYREACH_ENABLED is set. Tests use an in-memory SMTP fake and a local
// server. They do not dial a provider.
package channels
