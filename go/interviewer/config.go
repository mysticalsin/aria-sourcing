package interviewer

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

const defaultHTTPTimeout = 5 * time.Second

// Config is the hand-off runtime configuration.
// ARIA_INTERVIEWER_ENABLED defaults off. An empty or unrecognised value
// does not enable the adapter; only the exact tokens true, TRUE, True, and 1 do.
type Config struct {
	BaseURL       string
	APIKey        string
	WebhookSecret string
	Enabled       bool
	HTTPTimeout   time.Duration
}

// ConfigFromEnv reads the process environment. It does not log the API key.
func ConfigFromEnv() Config {
	raw := os.Getenv("ARIA_INTERVIEWER_ENABLED")
	return Config{
		BaseURL:       os.Getenv("INTERVIEWER_BASE_URL"),
		APIKey:        os.Getenv("INTERVIEWER_API_KEY"),
		WebhookSecret: os.Getenv("INTERVIEWER_WEBHOOK_SECRET"),
		Enabled:       raw == "true" || raw == "TRUE" || raw == "True" || raw == "1",
		HTTPTimeout:   defaultHTTPTimeout,
	}
}

// ValidateBaseURL accepts https for any host and http only for loopback.
// Credentials in the URL are rejected so the API key cannot ride in the authority.
func ValidateBaseURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Hostname() == "" {
		return fmt.Errorf("%w: interviewer base url", ErrValidation)
	}
	if u.User != nil {
		return fmt.Errorf("%w: interviewer base url credentials", ErrValidation)
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		if isLoopbackHost(u.Hostname()) {
			return nil
		}
		return fmt.Errorf("%w: interviewer base url must be https", ErrValidation)
	default:
		return fmt.Errorf("%w: interviewer base url scheme", ErrValidation)
	}
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func endpointURL(base, id string) (string, error) {
	if err := ValidateBaseURL(base); err != nil {
		return "", err
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("%w: interviewer base url", ErrValidation)
	}
	u.Path = "/v1/screenings"
	if id != "" {
		u.Path += "/" + url.PathEscape(id)
	}
	u.RawQuery = ""
	u.Fragment = ""
	u.User = nil
	return u.String(), nil
}
