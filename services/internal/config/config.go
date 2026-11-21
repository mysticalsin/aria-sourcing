// Package config loads the Aria service environment.
//
// Only the names in EnvNames are read. Logs, String, GoString, JSON, and slog
// all render a set/unset summary. Values are never included.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
)

const (
	EnvOdooURL            = "ODOO_URL"
	EnvOdooDB             = "ODOO_DB"
	EnvOdooAPIKey         = "ODOO_API_KEY"
	EnvOdooVersion        = "ODOO_VERSION"
	EnvAriaMode           = "ARIA_MODE"
	EnvRecipientAllowlist = "ARIA_RECIPIENT_ALLOWLIST"
)

// EnvNames is the only set of environment names this process reads.
var EnvNames = []string{
	EnvOdooURL,
	EnvOdooDB,
	EnvOdooAPIKey,
	EnvOdooVersion,
	EnvAriaMode,
	EnvRecipientAllowlist,
}

var (
	// ErrLiveRefused means ARIA_MODE asked for live and this build will not.
	ErrLiveRefused = errors.New("ARIA_MODE live is refused without Tony's explicit go")
	// ErrMode means ARIA_MODE was set to something other than demo or test.
	ErrMode = errors.New("ARIA_MODE must be demo or test")
	// ErrVersion means ODOO_VERSION was set to something other than 18 or 19.
	ErrVersion = errors.New("ODOO_VERSION must be 18 or 19")
)

// Secret is an environment value that must not be printed.
type Secret struct {
	v string
}

// String redacts the value.
func (s Secret) String() string { return "[redacted]" }

// GoString redacts the value.
func (s Secret) GoString() string { return "[redacted]" }

// MarshalJSON redacts the value.
func (s Secret) MarshalJSON() ([]byte, error) { return []byte(`"[redacted]"`), nil }

// LogValue redacts the value for slog.
func (s Secret) LogValue() slog.Value { return slog.StringValue("[redacted]") }

// Value returns the raw secret for the JSON-2 header. Do not log the result.
func (s Secret) Value() string { return s.v }

// IsSet reports whether a value was present.
func (s Secret) IsSet() bool { return s.v != "" }

// Config is the loaded environment. Formatting it never prints values.
type Config struct {
	OdooURL     string
	OdooDB      string
	OdooAPIKey  Secret
	OdooVersion string
	VersionSet  bool
	AriaMode    string
	ModeSet     bool
	Allowlist   []string
}

// String is the set/unset summary.
func (c Config) String() string { return c.LogSummary() }

// GoString is the set/unset summary.
func (c Config) GoString() string { return c.LogSummary() }

// MarshalJSON is the set/unset summary.
func (c Config) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]string{"summary": c.LogSummary()})
}

// LogValue is the set/unset summary for slog.
func (c Config) LogValue() slog.Value { return slog.StringValue(c.LogSummary()) }

// LogSummary lists each known name as set or unset. It does not read values.
func (c Config) LogSummary() string {
	parts := []struct {
		name string
		set  bool
	}{
		{EnvOdooURL, c.OdooURL != ""},
		{EnvOdooDB, c.OdooDB != ""},
		{EnvOdooAPIKey, c.OdooAPIKey.IsSet()},
		{EnvOdooVersion, c.VersionSet},
		{EnvAriaMode, c.ModeSet},
		{EnvRecipientAllowlist, len(c.Allowlist) > 0},
	}
	var b strings.Builder
	b.WriteString("config")
	for _, part := range parts {
		b.WriteByte(' ')
		b.WriteString(part.name)
		if part.set {
			b.WriteString("=set")
		} else {
			b.WriteString("=unset")
		}
	}
	return b.String()
}

// LookupAllowed wraps getenv so only EnvNames are forwarded.
func LookupAllowed(getenv func(string) (string, bool)) func(string) (string, bool) {
	allowed := make(map[string]struct{}, len(EnvNames))
	for _, name := range EnvNames {
		allowed[name] = struct{}{}
	}
	return func(name string) (string, bool) {
		if _, ok := allowed[name]; !ok {
			return "", false
		}
		if getenv == nil {
			return "", false
		}
		return getenv(name)
	}
}

// Load reads EnvNames through lookup and nothing else.
// An unset mode defaults to test. An unset version defaults to 19.
// live is refused. The error text never includes the looked-up value.
func Load(lookup func(string) (string, bool)) (Config, error) {
	if lookup == nil {
		return Config{}, errors.New("config lookup is required")
	}
	values := make(map[string]string, len(EnvNames))
	present := make(map[string]bool, len(EnvNames))
	for _, name := range EnvNames {
		v, ok := lookup(name)
		present[name] = ok && strings.TrimSpace(v) != ""
		values[name] = strings.TrimSpace(v)
	}
	cfg := Config{
		OdooURL:    values[EnvOdooURL],
		OdooDB:     values[EnvOdooDB],
		OdooAPIKey: Secret{v: values[EnvOdooAPIKey]},
	}
	switch values[EnvOdooVersion] {
	case "":
		cfg.OdooVersion = "19"
	case "19", "19.0":
		cfg.OdooVersion = "19"
		cfg.VersionSet = true
	case "18", "18.0":
		cfg.OdooVersion = "18"
		cfg.VersionSet = true
	default:
		return Config{}, ErrVersion
	}
	switch values[EnvAriaMode] {
	case "":
		cfg.AriaMode = "test"
	case "demo", "test":
		cfg.AriaMode = values[EnvAriaMode]
		cfg.ModeSet = true
	case "live":
		return Config{}, ErrLiveRefused
	default:
		return Config{}, ErrMode
	}
	if present[EnvRecipientAllowlist] {
		cfg.Allowlist = splitList(values[EnvRecipientAllowlist])
	}
	return cfg, nil
}

func splitList(raw string) []string {
	var out []string
	seen := map[string]struct{}{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, ok := seen[part]; ok {
			continue
		}
		seen[part] = struct{}{}
		out = append(out, part)
	}
	return out
}

// EffectiveVersion is documented for callers that need the major version.
func (c Config) EffectiveVersion() string {
	if c.OdooVersion == "" {
		return "19"
	}
	return c.OdooVersion
}

// FormatError is a static helper so callers do not fmt a raw environment value.
func FormatError(err error) string {
	if err == nil {
		return ""
	}
	return fmt.Sprintf("%s", err.Error())
}
