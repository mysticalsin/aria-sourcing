// Package app wires the process. Demo and test modes use the in-memory
// Odoo fake and the DNA fake. Live mode is refused. The JSON-2 client is not
// constructed here.
package app

import (
	"context"
	"net/http"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/api"
	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/config"
	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/ledger"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/recruit"
)

// ListenAddr is the only address the process binds. It is not an environment value.
const ListenAddr = "127.0.0.1:8080"

// Run loads config, logs the set/unset summary, and serves the fake backend.
// lookup should be config.LookupAllowed(os.LookupEnv) so other names are never read.
func Run(ctx context.Context, lookup func(string) (string, bool), logf func(string), serve func(http.Handler) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	if logf != nil {
		logf(cfg.LogSummary())
	}
	if serve == nil {
		return errString("serve is required")
	}
	now := time.Now
	log := audit.New(now)
	led := ledger.New(now)
	fake, err := odoo.NewFake(cfg.EffectiveVersion(), log, now)
	if err != nil {
		return err
	}
	svc := recruit.New(fake, dna.NewFake(), led, log, cfg.Allowlist, now)
	handler := api.New(svc, cfg.AriaMode, cfg.EffectiveVersion())
	token, actor := cfg.Identity()
	handler.UseIdentity(token, actor)
	return serve(handler)
}

type errString string

func (e errString) Error() string { return string(e) }
