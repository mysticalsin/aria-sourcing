package channels

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func BenchmarkPrepareEmail(b *testing.B) {
	rig := newEmailRig(emailEnv(nil))
	draft := emailDraft()
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := rig.email.Prepare(ctx, draft); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSendEmail(b *testing.B) {
	rig := newEmailRig(emailEnv(map[string]string{"ARIA_EMAIL_SENDER_DAILY_CAP": "1000000000"}))
	msg := rig.approved(b, CampaignMode{Mode: "manual"})
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := rig.email.Send(ctx, msg); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkPrepareHeyReach(b *testing.B) {
	rig := newHeyRig(nil, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	draft := heyDraft()
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := rig.ch.Prepare(ctx, draft); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSendHeyReach(b *testing.B) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	clock := &manualClock{now: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)}
	ch := NewHeyReach(HeyReachConfig{
		Env: heyEnv(srv.URL, map[string]string{
			"ARIA_HEYREACH_SENDER_DAILY_CAP":  "1000000000",
			"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "1000000000",
			"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
		}),
		TokenKey: tokenKey(),
		Auditor:  &memAudit{},
		Clock:    clock,
		HTTP:     srv.Client(),
	})
	exact, err := ch.Prepare(context.Background(), heyDraft())
	if err != nil {
		b.Fatal(err)
	}
	tok, err := IssueToken(tokenKey(), exact, clock.Now().Add(24*time.Hour))
	if err != nil {
		b.Fatal(err)
	}
	msg := ApprovedMessage{
		Exact: exact, Token: tok, DeliverTo: heyRecipient, SenderID: heySender, SenderAccountID: 42,
		Campaign: CampaignMode{Mode: "manual"},
	}
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := ch.Send(ctx, msg); err != nil {
			b.Fatal(err)
		}
	}
}
