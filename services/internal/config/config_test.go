package config_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/config"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

const canary = "canary-not-a-credential"

func TestLoaderReadsOnlyNamedVariables(t *testing.T) {
	var got []string
	_, err := config.Load(func(name string) (string, bool) {
		got = append(got, name)
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != strings.Join(config.EnvNames, ",") {
		t.Fatalf("lookup names = %v, want %v", got, config.EnvNames)
	}
}

func TestLookupAllowedDoesNotReadOtherNames(t *testing.T) {
	called := false
	lookup := config.LookupAllowed(func(name string) (string, bool) {
		called = true
		if name != config.EnvOdooAPIKey {
			t.Errorf("getenv called for %s", name)
		}
		return canary, true
	})
	if v, ok := lookup("HOME"); ok || v != "" || called {
		t.Fatalf("HOME lookup leaked: %q ok=%v called=%v", v, ok, called)
	}
	v, ok := lookup(config.EnvOdooAPIKey)
	if !ok || v != canary {
		t.Fatalf("allowed lookup = %q ok=%v", v, ok)
	}
}

func TestLogNeverPrintsValues(t *testing.T) {
	cfg, err := config.Load(func(name string) (string, bool) {
		switch name {
		case config.EnvOdooURL:
			return "http://" + canary + ".example.test", true
		case config.EnvOdooDB:
			return canary + "-db", true
		case config.EnvOdooAPIKey:
			return canary, true
		case config.EnvOdooVersion:
			return "19", true
		case config.EnvAriaMode:
			return "test", true
		case config.EnvRecipientAllowlist:
			return canary + "@people.example.test", true
		default:
			t.Fatalf("unexpected name %s", name)
			return "", false
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	summary := cfg.LogSummary()
	const want = "config ODOO_URL=set ODOO_DB=set ODOO_API_KEY=set ODOO_VERSION=set ARIA_MODE=set ARIA_RECIPIENT_ALLOWLIST=set"
	if summary != want {
		t.Fatalf("summary = %q", summary)
	}
	if strings.Contains(summary, canary) || strings.Contains(summary, "19") || strings.Contains(summary, "test") {
		t.Fatalf("summary printed a value: %s", summary)
	}
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	logger.Info("startup", "config", cfg, "key", cfg.OdooAPIKey)
	blob := strings.Join([]string{
		buf.String(),
		cfg.String(),
		fmt.Sprintf("%#v", cfg),
		fmt.Sprintf("%v", cfg.OdooAPIKey),
		mustJSON(t, cfg),
	}, "\n")
	if strings.Contains(blob, canary) {
		t.Fatalf("value leaked:\n%s", blob)
	}
}

func TestLiveAndBadValuesAreRefusedWithoutEcho(t *testing.T) {
	cases := []struct {
		name string
		mode string
		ver  string
		want error
	}{
		{name: "live", mode: "live", ver: "19", want: config.ErrLiveRefused},
		{name: "bad mode", mode: canary, ver: "19", want: config.ErrMode},
		{name: "bad version", mode: "test", ver: canary, want: config.ErrVersion},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := config.Load(func(name string) (string, bool) {
				switch name {
				case config.EnvAriaMode:
					return tc.mode, true
				case config.EnvOdooVersion:
					return tc.ver, true
				case config.EnvOdooAPIKey:
					return canary, true
				default:
					return "", false
				}
			})
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if err != nil && strings.Contains(err.Error(), canary) {
				t.Fatalf("error echoed value: %v", err)
			}
		})
	}
}

func TestDefaultsAreTestAndOdoo19(t *testing.T) {
	cfg, err := config.Load(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AriaMode != "test" || cfg.ModeSet {
		t.Fatalf("mode = %s set=%v", cfg.AriaMode, cfg.ModeSet)
	}
	if cfg.EffectiveVersion() != "19" || cfg.VersionSet {
		t.Fatalf("version = %s set=%v", cfg.OdooVersion, cfg.VersionSet)
	}
	if cfg.LogSummary() != "config ODOO_URL=unset ODOO_DB=unset ODOO_API_KEY=unset ODOO_VERSION=unset ARIA_MODE=unset ARIA_RECIPIENT_ALLOWLIST=unset" {
		t.Fatal(cfg.LogSummary())
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
