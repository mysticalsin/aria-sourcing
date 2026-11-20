package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/app"
	"github.com/mysticalsin/aria-sourcing/services/internal/config"
)

func main() {
	err := app.Run(context.Background(), config.LookupAllowed(os.LookupEnv), func(summary string) {
		slog.Info(summary)
	}, func(h http.Handler) error {
		srv := &http.Server{
			Addr:              app.ListenAddr,
			Handler:           h,
			ReadHeaderTimeout: 5 * time.Second,
		}
		return srv.ListenAndServe()
	})
	if err != nil {
		slog.Error("aria-services stopped", "err", err.Error())
		os.Exit(1)
	}
}
