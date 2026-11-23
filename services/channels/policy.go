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
	recipient, err := canonicalDelivery(exact.Recipient)
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

// CanonicalRecipient accepts one mailbox: local@domain, with a dotted domain.
// Incomplete values such as "ada@" and non-addresses such as "not-an-email"
// are refused. Comparison is case-insensitive.
func CanonicalRecipient(raw string) (string, error) {
	recipient := strings.ToLower(strings.TrimSpace(raw))
	if recipient == "" || strings.ContainsAny(recipient, " \t\r\n") {
		return "", ErrConfig
	}
	local, domain, ok := strings.Cut(recipient, "@")
	if !ok || local == "" || domain == "" || strings.Contains(local, "@") {
		return "", ErrConfig
	}
	if !validMailboxLocal(local) || !validMailboxDomain(domain) {
		return "", ErrConfig
	}
	return recipient, nil
}

func validMailboxLocal(local string) bool {
	if len(local) > 64 {
		return false
	}
	for _, r := range local {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '.' || r == '_' || r == '%' || r == '+' || r == '-':
		default:
			return false
		}
	}
	return true
}

func validMailboxDomain(domain string) bool {
	if len(domain) > 253 || !strings.Contains(domain, ".") || strings.Contains(domain, "..") {
		return false
	}
	if strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return false
	}
	for _, label := range strings.Split(domain, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, r := range label {
			switch {
			case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			default:
				return false
			}
		}
	}
	return true
}

// canonicalDelivery accepts a mailbox or a single-line conversation id.
func canonicalDelivery(raw string) (string, error) {
	if strings.Contains(raw, "@") {
		return CanonicalRecipient(raw)
	}
	recipient := strings.TrimSpace(raw)
	if recipient == "" || strings.ContainsAny(recipient, " \t\r\n") {
		return "", ErrConfig
	}
	for _, r := range recipient {
		if r <= 0x20 || r >= 0x7f {
			return "", ErrConfig
		}
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

func killSwitchEngaged(env LiveEnv, key string) bool {
	value, ok := lookup(env, key)
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

func allowlisted(env LiveEnv, recipient string) bool {
	raw, ok := lookup(env, "ARIA_RECIPIENT_ALLOWLIST")
	if !ok {
		return false
	}
	for _, part := range splitList(raw) {
		canonical, err := canonicalDelivery(part)
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

func heyreachEnabled(env LiveEnv) error {
	value, ok := lookup(env, "ARIA_HEYREACH_ENABLED")
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

func parseCap(env LiveEnv, key string) (int, error) {
	raw, ok := lookup(env, key)
	if !ok || strings.TrimSpace(raw) == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0, ErrConfig
	}
	return n, nil
}

func parseGap(env LiveEnv) (time.Duration, error) {
	raw, ok := lookup(env, "ARIA_HEYREACH_MIN_GAP_SECONDS")
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

func senderAllowed(env LiveEnv, identity string) bool {
	raw, ok := lookup(env, "ARIA_SENDER_ALLOWLIST")
	if !ok {
		return false
	}
	want, err := canonicalSender(identity)
	if err != nil {
		return false
	}
	for _, part := range splitList(raw) {
		got, err := canonicalSender(part)
		if err != nil {
			continue
		}
		if got == want {
			return true
		}
	}
	return false
}

func canonicalSender(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, "\r\n") {
		return "", ErrSender
	}
	if strings.Contains(raw, "@") {
		return CanonicalRecipient(raw)
	}
	return raw, nil
}

func authorize(env LiveEnv, msg ApprovedMessage, channel string, extraKill []string, notice bool) (ExactText, error) {
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
	deliver, err := canonicalDelivery(msg.DeliverTo)
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
		host, _ := lookup(env, "ARIA_UNSUBSCRIBE_HOST")
		link, err := validateUnsubscribe(exact.UnsubscribeURL, host)
		if err != nil {
			return exact, err
		}
		exact.UnsubscribeURL = link
	}
	if strings.TrimSpace(msg.SenderID) == "" {
		return exact, ErrSender
	}
	identity := strings.TrimSpace(msg.From)
	if channel == "heyreach" {
		identity = strconv.FormatInt(msg.SenderAccountID, 10)
	}
	if !senderAllowed(env, identity) {
		return exact, ErrSenderAllowlist
	}
	return exact, nil
}
