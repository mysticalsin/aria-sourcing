package odoo_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
)

func BenchmarkAdapterUpsertThroughput(b *testing.B) {
	f, _ := newFake(b, "19")
	mustJob(b, f)
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := f.UpsertApplicant(ctx, odoo.Applicant{
			AriaID: fmt.Sprintf("cand-%d", i), IdempotencyKey: fmt.Sprintf("idem-%d", i),
			PartnerName: "Mina Ortega", EmailFrom: fmt.Sprintf("mina.%d@people.example.test", i),
			JobAriaID: "job-1", Source: "Candidate-supplied",
			SmartNeedID: "need-1001", SmartCandidateID: fmt.Sprintf("smart-%d", i),
		})
		if err != nil {
			b.Fatal(err)
		}
	}
	b.StopTimer()
	if elapsed := b.Elapsed().Seconds(); elapsed > 0 {
		b.ReportMetric(float64(b.N)/elapsed, "upserts/s")
	}
}

func BenchmarkAdapterReplayThroughput(b *testing.B) {
	f, _ := newFake(b, "19")
	mustJob(b, f)
	ctx := context.Background()
	in := applicantInput()
	if _, err := f.UpsertApplicant(ctx, in); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := f.UpsertApplicant(ctx, in); err != nil {
			b.Fatal(err)
		}
	}
	b.StopTimer()
	if elapsed := b.Elapsed().Seconds(); elapsed > 0 {
		b.ReportMetric(float64(b.N)/elapsed, "replays/s")
	}
}

func BenchmarkAdapterTouchThroughput(b *testing.B) {
	f, _ := newFake(b, "19")
	mustJob(b, f)
	ctx := context.Background()
	app, err := f.UpsertApplicant(ctx, applicantInput())
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := f.LogTouch(ctx, odoo.Touch{
			IdempotencyKey: fmt.Sprintf("touch-%d", i), ApplicantAriaID: app.AriaID,
			Channel: "email", Kind: "message", Subject: "Hello", Body: "Synthetic outreach body",
		})
		if err != nil {
			b.Fatal(err)
		}
	}
	b.StopTimer()
	if elapsed := b.Elapsed().Seconds(); elapsed > 0 {
		b.ReportMetric(float64(b.N)/elapsed, "touches/s")
	}
}
