package app_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/app"
	"github.com/mysticalsin/aria-sourcing/services/internal/config"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

const canary = "canary-not-a-credential"

func TestRunLogsNamesOnlyAndServesTheFake(t *testing.T) {
	var logs []string
	err := app.Run(context.Background(), func(name string) (string, bool) {
		switch name {
		case config.EnvOdooURL:
			return "http://" + canary + ".example.test", true
		case config.EnvOdooDB:
			return canary, true
		case config.EnvOdooAPIKey:
			return canary, true
		case config.EnvAriaMode:
			return "test", true
		case config.EnvOdooVersion:
			return "19", true
		case config.EnvRecipientAllowlist:
			return canary + "@people.example.test", true
		case config.EnvAriaAPIToken:
			return "", false
		default:
			t.Fatalf("unexpected env %s", name)
			return "", false
		}
	}, func(line string) {
		logs = append(logs, line)
	}, func(h http.Handler) error {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
		if rec.Code != 200 || strings.Contains(rec.Body.String(), canary) {
			t.Fatalf("health %d %s", rec.Code, rec.Body)
		}
		if !strings.Contains(rec.Body.String(), `"backend":"fake"`) || !strings.Contains(rec.Body.String(), `"odoo_version":"19"`) {
			t.Fatalf("health %s", rec.Body)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	blob := strings.Join(logs, "\n")
	if strings.Contains(blob, canary) || !strings.Contains(blob, "ODOO_API_KEY=set") || strings.Contains(blob, "=19") {
		t.Fatalf("logs = %s", blob)
	}
}

func TestRunRefusesLiveWithoutEcho(t *testing.T) {
	called := false
	err := app.Run(context.Background(), func(name string) (string, bool) {
		if name == config.EnvAriaMode {
			return "live", true
		}
		if name == config.EnvOdooAPIKey {
			return canary, true
		}
		return "", false
	}, func(string) { called = true }, func(http.Handler) error {
		t.Fatal("serve called")
		return nil
	})
	if !errors.Is(err, config.ErrLiveRefused) || called || strings.Contains(err.Error(), canary) {
		t.Fatalf("err=%v called=%v", err, called)
	}
}
