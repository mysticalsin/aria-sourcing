package ingest_test

import (
	"context"
	"fmt"
	"strconv"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/ingest"
	"github.com/mysticalsin/aria-sourcing/services/ingest/dedupe"
	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
	"github.com/mysticalsin/aria-sourcing/services/ingest/source"
	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

// BenchmarkIngestTextCVs measures the text-layer path, which does not call
// Tesseract. CVs/s is how many uploads reach ready_for_to_rate per second.
// The sink is a no-op so the number is the worker, not an Odoo round trip.
func BenchmarkIngestTextCVs(b *testing.B) {
	const n = 32
	pdfs := make([][]byte, n)
	for i := 0; i < n; i++ {
		pdfs[i] = extract.BuildTextPDF([]string{
			"Name: Bench Candidate",
			fmt.Sprintf("Email: bench-%d@example.test", i),
			"Phone: +33 1 99 00 11 22",
			"Location: Lyon, France",
			"Skills: Go, PostgreSQL, Recruiting",
			"Languages: English, French",
			"Experience:",
			"2020-2024 | Recruiter | Example Consulting",
		})
	}
	w := ingest.New(ingest.Options{
		Logger:  ingest.NopLogger{},
		Sink:    discardSink{},
		Deduper: dedupe.NewMemory(),
	})
	origin := source.Origin{CVSource: "toast-upload", Folder: "holding"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		res, err := w.Ingest(context.Background(), ingest.Upload{
			ID:     "b" + strconv.Itoa(i),
			Bytes:  pdfs[i%n],
			Origin: origin,
		})
		if err != nil {
			b.Fatal(err)
		}
		if res.State != state.ReadyForToRate {
			b.Fatalf("state %s reason %s", res.State, res.Reason)
		}
	}
	if elapsed := b.Elapsed().Seconds(); elapsed > 0 {
		b.ReportMetric(float64(b.N)/elapsed, "CVs/s")
	}
}

type discardSink struct{}

func (discardSink) UpsertSource(context.Context, source.Record) error { return nil }
