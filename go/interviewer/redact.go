package interviewer

import "regexp"

// Redact removes emails, phone numbers and URLs from text that would otherwise
// be sent to the interviewer or stored on the advisory report. The replacement
// is a fixed marker so the surrounding words stay readable.
const redactedMark = "[redacted]"

var (
	emailPattern = regexp.MustCompile(`(?i)\b[a-z0-9._%+\-]+@[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}\b`)
	urlPattern   = regexp.MustCompile(`(?i)(?:https?://|www\.)[^\s<>"']+`)
	phonePattern = regexp.MustCompile(`\+\d{1,3}(?:[\s.\-]*\d{2,4}){2,4}|\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}`)
)

// Redact applies the contact-data allowlist scrub. Non-contact words are kept.
func Redact(text string) string {
	text = urlPattern.ReplaceAllString(text, redactedMark)
	text = emailPattern.ReplaceAllString(text, redactedMark)
	text = phonePattern.ReplaceAllString(text, redactedMark)
	return text
}
