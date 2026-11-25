package interviewer

import "regexp"

// Redact removes emails, phone numbers and URLs from text that would otherwise
// be sent to the interviewer or stored on the advisory report. The replacement
// is a fixed marker so the surrounding words stay readable.
const redactedMark = "[redacted]"

var (
	emailPattern = regexp.MustCompile(`(?i)\b[a-z0-9._%+\-]+@[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}\b`)
	// Scheme-relative URLs, mailto, and tel are contact data even without https://.
	urlPattern = regexp.MustCompile(`(?i)(?:https?://|//|www\.|mailto:|tel:)[^\s<>"']+`)
	// A leading plus needs 8 digits. A national number needs 10, so a date
	// like 2026-11-25 is left alone. Separators are spaces, dots, hyphens,
	// and parentheses, which covers +1(415)555-0130 and +33 6 12 34 56 78.
	phonePattern = regexp.MustCompile(`(?:\+\d(?:[\s().-]*\d){7,}|\(?\d(?:[\s().-]*\d){9,})`)
)

// Redact applies the contact-data allowlist scrub. Non-contact words are kept.
func Redact(text string) string {
	text = urlPattern.ReplaceAllString(text, redactedMark)
	text = emailPattern.ReplaceAllString(text, redactedMark)
	text = phonePattern.ReplaceAllString(text, redactedMark)
	return text
}
