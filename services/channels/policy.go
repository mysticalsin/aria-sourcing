package channels

import (
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func normalizeExact(exact ExactText, expectChannel string) (ExactText, error) {
	channel, err := CanonicalChannel(exact.Channel)
	if err != nil {
		return ExactText{}, err
	}
	if expectChannel != "" && channel != expectChannel {
		return ExactText{}, ErrChannel
	}
	recipient, err := CanonicalRecipient(exact.Recipient)
	if err != nil {
		return ExactText{}, err
	}
	subject, err := CanonicalSubject(exact.Subject)
	if err != nil {
		return ExactText{}, err
	}
	if strings.TrimSpace(exact.Body) == "" {
		return ExactText{}, ErrConfig
	}
	hash := BodyHash(exact.Body)
	if exact.BodyHash != "" && !same(exact.BodyHash, hash) {
		return ExactText{}, ErrBinding
	}
	exact.Channel = channel
	exact.Recipient = recipient
	exact.Subject = subject
	exact.BodyHash = hash
	return exact, nil
}

// CanonicalChannel accepts the two adapters in this module.
func CanonicalChannel(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "email", "heyreach":
		return strings.ToLower(strings.TrimSpace(raw)), nil
	default:
		return "", ErrChannel
	}
}

// CanonicalRecipient trims the delivery target. Addresses that contain @
// are compared case-insensitively. Other ids keep their case.
func CanonicalRecipient(raw string) (string, error) {
	recipient := strings.TrimSpace(raw)
	if recipient == "" || strings.ContainsAny(recipient, "\r\n") {
		return "", ErrConfig
	}
	for _, r := range recipient {
		if r < 0x20 || r == 0x7f {
			return "", ErrConfig
		}
	}
	if strings.Contains(recipient, "@") {
		if strings.ContainsAny(recipient, " \t") {
			return "", ErrConfig
		}
		recipient = strings.ToLower(recipient)
	}
	return recipient, nil
}

// CanonicalSubject rejects control characters so a subject cannot break headers.
func CanonicalSubject(raw string) (string, error) {
	subject := strings.TrimSpace(raw)
	if subject == "" {
		return "", ErrConfig
	}
	for _, r := range subject {
		if r < 0x20 || r == 0x7f {
			return "", ErrConfig
		}
	}
	return subject, nil
}

func killSwitchEngaged(env Environ, key string) bool {
	value, ok := env.Lookup(key)
	if !ok {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "false", "off":
		return false
	default:
		return true
	}
}

func allowlisted(env Environ, recipient string) bool {
	raw, ok := env.Lookup("ARIA_RECIPIENT_ALLOWLIST")
	if !ok {
		return false
	}
	for _, part := range splitList(raw) {
		canonical, err := CanonicalRecipient(part)
		if err != nil {
			continue
		}
		if canonical == recipient {
			return true
		}
	}
	return false
}

func splitList(raw string) []string {
	return strings.FieldsFunc(raw, func(r rune) bool {
		switch r {
		case ',', ';', ' ', '\t', '\n', '\r':
			return true
		default:
			return false
		}
	})
}

func enforceMode(mode CampaignMode) error {
	switch strings.ToLower(strings.TrimSpace(mode.Mode)) {
	case "", "manual":
		return nil
	case "auto":
		if !mode.AutoOptIn {
			return ErrMode
		}
		if !mode.QCPass {
			return ErrQC
		}
		return nil
	default:
		return ErrMode
	}
}

func heyreachEnabled(env Environ) error {
	value, ok := env.Lookup("ARIA_HEYREACH_ENABLED")
	if !ok {
		return ErrDisabled
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "on":
		return nil
	default:
		return ErrDisabled
	}
}

func parseCap(env Environ, key string) (int, error) {
	raw, ok := env.Lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0, ErrConfig
	}
	return n, nil
}

func parseGap(env Environ) (time.Duration, error) {
	raw, ok := env.Lookup("ARIA_HEYREACH_MIN_GAP_SECONDS")
	if !ok || strings.TrimSpace(raw) == "" {
		return 0, ErrConfig
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0, ErrConfig
	}
	return time.Duration(n) * time.Second, nil
}

func loopbackHost(hostport string) bool {
	host := hostport
	if parsed, _, err := net.SplitHostPort(hostport); err == nil {
		host = parsed
	}
	host = strings.Trim(host, "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func validateHTTPURL(raw string, allowCleartextLoopback bool) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, "\r\n") {
		return nil, ErrConfig
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return nil, ErrConfig
	}
	switch parsed.Scheme {
	case "https":
	case "http":
		if !allowCleartextLoopback || !loopbackHost(parsed.Host) {
			return nil, ErrConfig
		}
	default:
		return nil, ErrConfig
	}
	return parsed, nil
}

func authorize(env Environ, key []byte, now time.Time, msg ApprovedMessage, channel string, extraKill []string, notice bool) (ExactText, error) {
	if killSwitchEngaged(env, "ARIA_SEND_KILL_SWITCH") {
		return msg.Exact, ErrKillSwitch
	}
	for _, name := range extraKill {
		if killSwitchEngaged(env, name) {
			return msg.Exact, ErrKillSwitch
		}
	}
	if channel == "heyreach" {
		if err := heyreachEnabled(env); err != nil {
			return msg.Exact, err
		}
	}
	deliver, err := CanonicalRecipient(msg.DeliverTo)
	if err != nil {
		return msg.Exact, err
	}
	if !allowlisted(env, deliver) {
		return msg.Exact, ErrAllowlist
	}
	exact, err := normalizeExact(msg.Exact, channel)
	if err != nil {
		return msg.Exact, err
	}
	if err := VerifyToken(key, msg.Token, exact, now); err != nil {
		return exact, err
	}
	if deliver != exact.Recipient {
		return exact, ErrBinding
	}
	if err := enforceMode(msg.Campaign); err != nil {
		return exact, err
	}
	if notice {
		if err := requireEmailNotice(exact); err != nil {
			return exact, err
		}
	}
	if strings.TrimSpace(msg.SenderID) == "" {
		return exact, ErrSender
	}
	return exact, nil
}
