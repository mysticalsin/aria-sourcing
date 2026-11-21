package channels

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type capturedCall struct {
	Path  string
	Host  string
	Key   string
	Body  []byte
	Query string
}

type heyServer struct {
	srv     *httptest.Server
	mu      sync.Mutex
	calls   []capturedCall
	status  int
	payload string
}

func newHeyServer(status int, payload string) *heyServer {
	h := &heyServer{status: status, payload: payload}
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		h.mu.Lock()
		h.calls = append(h.calls, capturedCall{
			Path: r.URL.Path, Host: r.Host, Key: r.Header.Get("X-API-KEY"), Body: body, Query: r.URL.RawQuery,
		})
		status := h.status
		payload := h.payload
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if status == http.StatusFound {
			w.Header().Set("Location", "/followed")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(payload))
	}))
	return h
}

func (h *heyServer) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.calls)
}

func (h *heyServer) snapshot() []capturedCall {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]capturedCall, len(h.calls))
	copy(out, h.calls)
	return out
}

type heyRig struct {
	ch    *HeyReach
	audit *memAudit
	clock *manualClock
	http  *heyServer
}

func newHeyRig(extra map[string]string, status int, payload string) heyRig {
	srv := newHeyServer(status, payload)
	audit := &memAudit{}
	clock := &manualClock{now: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)}
	ch, err := newHeyReachForTest(HeyReachConfig{
		Env:      heyEnv(srv.srv.URL, extra),
		TokenKey: tokenKey(),
		Auditor:  audit,
		Clock:    clock,
		HTTP:     srv.srv.Client(),
	})
	if err != nil {
		panic(err)
	}
	return heyRig{ch: ch, audit: audit, clock: clock, http: srv}
}

func (r heyRig) approved(t *testing.T, mode CampaignMode) ApprovedMessage {
	t.Helper()
	exact, err := r.ch.Prepare(context.Background(), heyDraft())
	if err != nil {
		t.Fatal(err)
	}
	return ApprovedMessage{
		Exact:           exact,
		Token:           mint(t, exact, mode, "", 42, r.clock.Now()),
		DeliverTo:       heyRecipient,
		SenderID:        heySender,
		SenderAccountID: 42,
		Campaign:        mode,
		Record:          MailRecord{Model: "aria.campaign", ResID: 7, Name: "Synthetic"},
	}
}

func TestHeyReachPrepareDoesNotCallNetwork(t *testing.T) {
	rig := newHeyRig(nil, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	exact, err := rig.ch.Prepare(context.Background(), heyDraft())
	if err != nil {
		t.Fatal(err)
	}
	if exact.Channel != "heyreach" || exact.Body != heyDraft().Body || exact.BodyHash != BodyHash(heyDraft().Body) {
		t.Fatalf("exact = %+v", exact)
	}
	if rig.http.count() != 0 {
		t.Fatal("Prepare called the public API")
	}
}

func TestHeyReachSendUsesPublicInboxAPI(t *testing.T) {
	rig := newHeyRig(nil, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	msg := rig.approved(t, CampaignMode{ID: "camp-synthetic", Mode: "manual"})
	if _, err := rig.ch.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	calls := rig.http.snapshot()
	if len(calls) != 1 {
		t.Fatalf("calls = %d", len(calls))
	}
	if calls[0].Path != "/api/public/inbox/SendMessage" {
		t.Fatalf("path = %s", calls[0].Path)
	}
	if calls[0].Key != syntheticAPIKey {
		t.Fatal("API key header mismatch")
	}
	if calls[0].Query != "" {
		t.Fatalf("query = %q", calls[0].Query)
	}
	var payload map[string]any
	if err := json.Unmarshal(calls[0].Body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["message"] != msg.Exact.Body || payload["subject"] != msg.Exact.Subject || payload["conversationId"] != heyRecipient {
		t.Fatalf("payload = %#v", payload)
	}
	if payload["linkedInAccountId"] != float64(42) {
		t.Fatalf("sender account = %#v", payload["linkedInAccountId"])
	}
	notes := rig.audit.snapshot()
	found := false
	for _, note := range notes {
		if strings.Contains(note.Body, "outcome=delivered") && note.MessageType == "notification" && note.SubtypeXMLID == "mail.mt_note" {
			found = true
		}
	}
	if !found {
		t.Fatalf("notes = %+v", notes)
	}
}

func TestHeyReachDisabledByDefault(t *testing.T) {
	srv := newHeyServer(http.StatusOK, `{"ok":true}`)
	defer srv.srv.Close()
	base := map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST":        heyRecipient,
		"ARIA_HEYREACH_SENDER_DAILY_CAP":  "10",
		"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "10",
		"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
		"HEYREACH_BASE_URL":               srv.srv.URL,
		"HEYREACH_API_KEY":                syntheticAPIKey,
		"ARIA_SENDER_ALLOWLIST":           "42",
	}
	clock := &manualClock{now: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)}
	ch, err := newHeyReachForTest(HeyReachConfig{Env: NewEnviron(base), TokenKey: tokenKey(), Auditor: &memAudit{}, Clock: clock, HTTP: srv.srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	exact, err := ch.Prepare(context.Background(), heyDraft())
	if err != nil {
		t.Fatal(err)
	}
	tok := mint(t, exact, CampaignMode{}, "", 42, clock.Now())
	_, err = ch.Send(context.Background(), ApprovedMessage{
		Exact: exact, Token: tok, DeliverTo: heyRecipient, SenderID: heySender, SenderAccountID: 42,
	})
	if !errors.Is(err, ErrDisabled) {
		t.Fatalf("error = %v", err)
	}
	if srv.count() != 0 {
		t.Fatal("disabled adapter called the API")
	}
	for _, value := range []string{"", "0", "false", "off", "yes"} {
		base["ARIA_HEYREACH_ENABLED"] = value
		ch, err = newHeyReachForTest(HeyReachConfig{Env: NewEnviron(base), TokenKey: tokenKey(), Auditor: &memAudit{}, Clock: clock, HTTP: srv.srv.Client()})
		if err != nil {
			t.Fatal(err)
		}
		_, err = ch.Send(context.Background(), ApprovedMessage{
			Exact: exact, Token: tok, DeliverTo: heyRecipient, SenderID: heySender, SenderAccountID: 42,
		})
		if !errors.Is(err, ErrDisabled) {
			t.Fatalf("enabled=%q error = %v", value, err)
		}
	}
	if srv.count() != 0 {
		t.Fatal("non-enabling values called the API")
	}
}

func TestHeyReachKillSwitchIsIndependentAndFailClosed(t *testing.T) {
	rig := newHeyRig(map[string]string{"ARIA_HEYREACH_KILL_SWITCH": "yes"}, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	_, err := rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{}))
	if !errors.Is(err, ErrKillSwitch) {
		t.Fatalf("channel switch: %v", err)
	}
	if rig.http.count() != 0 {
		t.Fatal("kill switch called the API")
	}

	rig = newHeyRig(map[string]string{"ARIA_HEYREACH_KILL_SWITCH": "0", "ARIA_SEND_KILL_SWITCH": "banana"}, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	_, err = rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{}))
	if !errors.Is(err, ErrKillSwitch) {
		t.Fatalf("global switch: %v", err)
	}
	if rig.http.count() != 0 {
		t.Fatal("global kill switch called the API")
	}

	// The channel switch does not stop email.
	email := newEmailRig(emailEnv(map[string]string{"ARIA_HEYREACH_KILL_SWITCH": "yes"}))
	if _, err := email.email.Send(context.Background(), email.approved(t, CampaignMode{})); err != nil {
		t.Fatal(err)
	}
}

func TestHeyReachAllowlistUsesRealConversation(t *testing.T) {
	rig := newHeyRig(nil, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	msg := rig.approved(t, CampaignMode{})
	msg.DeliverTo = "conversation-other"
	_, err := rig.ch.Send(context.Background(), msg)
	if !errors.Is(err, ErrAllowlist) {
		t.Fatalf("error = %v", err)
	}
	if rig.http.count() != 0 {
		t.Fatal("off-list conversation was sent")
	}
}

func TestHeyReachAutoModeRequiresCampaignOptInAndQC(t *testing.T) {
	rig := newHeyRig(nil, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	_, err := rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{Mode: "auto", QCPass: true}))
	if !errors.Is(err, ErrMode) {
		t.Fatalf("opt-in: %v", err)
	}
	_, err = rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{Mode: "auto", AutoOptIn: true}))
	if !errors.Is(err, ErrQC) {
		t.Fatalf("qc: %v", err)
	}
	if _, err := rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{Mode: "auto", AutoOptIn: true, QCPass: true})); err != nil {
		t.Fatal(err)
	}
	if rig.http.count() != 1 {
		t.Fatalf("calls = %d", rig.http.count())
	}
}

func TestHeyReachCapsAndPacing(t *testing.T) {
	rig := newHeyRig(map[string]string{
		"ARIA_HEYREACH_SENDER_DAILY_CAP":  "2",
		"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "2",
		"ARIA_HEYREACH_MIN_GAP_SECONDS":   "120",
	}, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	msg := rig.approved(t, CampaignMode{})
	if _, err := rig.ch.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	_, err := rig.ch.Send(context.Background(), msg)
	if !errors.Is(err, ErrPacing) {
		t.Fatalf("gap: %v", err)
	}
	rig.clock.Advance(2 * time.Minute)
	msg.Token = mint(t, msg.Exact, msg.Campaign, "", 42, rig.clock.Now())
	if _, err := rig.ch.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	rig.clock.Advance(2 * time.Minute)
	_, err = rig.ch.Send(context.Background(), msg)
	if !errors.Is(err, ErrDailyCap) && !errors.Is(err, ErrWeeklyCap) {
		t.Fatalf("cap: %v", err)
	}
	if rig.http.count() != 2 {
		t.Fatalf("calls = %d", rig.http.count())
	}

	other := msg
	other.SenderID = "sender-synthetic-2"
	other.Token = mint(t, other.Exact, other.Campaign, "", 42, rig.clock.Now())
	if _, err := rig.ch.Send(context.Background(), other); err != nil {
		t.Fatalf("other sender: %v", err)
	}
}

func TestHeyReachWeeklyCapResetsOnTheNextISOWeek(t *testing.T) {
	rig := newHeyRig(map[string]string{
		"ARIA_HEYREACH_SENDER_DAILY_CAP":  "5",
		"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "1",
		"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
	}, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	msg := rig.approved(t, CampaignMode{})
	if _, err := rig.ch.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	rig.clock.Advance(24 * time.Hour)
	_, err := rig.ch.Send(context.Background(), msg)
	if !errors.Is(err, ErrWeeklyCap) {
		t.Fatalf("same week: %v", err)
	}
	rig.clock.Set(time.Date(2026, 1, 12, 12, 0, 0, 0, time.UTC))
	fresh := rig.approved(t, CampaignMode{})
	if _, err := rig.ch.Send(context.Background(), fresh); err != nil {
		t.Fatalf("next week: %v", err)
	}
}

func TestHeyReachRefusesWhenCapsOrPacingUnset(t *testing.T) {
	cases := []struct {
		name string
		drop string
		want error
	}{
		{"daily", "ARIA_HEYREACH_SENDER_DAILY_CAP", ErrDailyCap},
		{"weekly", "ARIA_HEYREACH_SENDER_WEEKLY_CAP", ErrWeeklyCap},
		{"gap", "ARIA_HEYREACH_MIN_GAP_SECONDS", ErrConfig},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newHeyServer(http.StatusOK, `{"ok":true}`)
			defer srv.srv.Close()
			set := map[string]string{
				"ARIA_HEYREACH_ENABLED":           "on",
				"ARIA_RECIPIENT_ALLOWLIST":        heyRecipient,
				"ARIA_HEYREACH_SENDER_DAILY_CAP":  "10",
				"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "10",
				"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
				"HEYREACH_BASE_URL":               srv.srv.URL,
				"HEYREACH_API_KEY":                syntheticAPIKey,
				"ARIA_SENDER_ALLOWLIST":           "42",
			}
			delete(set, tc.drop)
			clock := &manualClock{now: time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)}
			ch, err := newHeyReachForTest(HeyReachConfig{Env: NewEnviron(set), TokenKey: tokenKey(), Auditor: &memAudit{}, Clock: clock, HTTP: srv.srv.Client()})
			if err != nil {
				t.Fatal(err)
			}
			exact, err := ch.Prepare(context.Background(), heyDraft())
			if err != nil {
				t.Fatal(err)
			}
			tok := mint(t, exact, CampaignMode{}, "", 42, clock.Now())
			_, err = ch.Send(context.Background(), ApprovedMessage{
				Exact: exact, Token: tok, DeliverTo: heyRecipient, SenderID: heySender, SenderAccountID: 42,
			})
			if !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
			if srv.count() != 0 {
				t.Fatal("misconfigured adapter called the API")
			}
		})
	}
}

func TestHeyReachAutoPausesOnAccountWarning(t *testing.T) {
	rig := newHeyRig(map[string]string{"ARIA_SENDER_ALLOWLIST": "42,99"}, http.StatusForbidden, `{"errorMessage":"Account warning: sender restricted"}`)
	defer rig.http.srv.Close()
	msg := rig.approved(t, CampaignMode{})
	_, err := rig.ch.Send(context.Background(), msg)
	if !errors.Is(err, ErrAccountWarning) {
		t.Fatalf("warning: %v", err)
	}
	_, err = rig.ch.Send(context.Background(), msg)
	if !errors.Is(err, ErrPaused) {
		t.Fatalf("paused: %v", err)
	}
	sameAccount := msg
	sameAccount.SenderID = "sender-synthetic-3"
	_, err = rig.ch.Send(context.Background(), sameAccount)
	if !errors.Is(err, ErrPaused) {
		t.Fatalf("same account: %v", err)
	}
	if rig.http.count() != 1 {
		t.Fatalf("calls after pause = %d", rig.http.count())
	}
	notes := rig.audit.snapshot()
	sawWarning := false
	for _, note := range notes {
		if strings.Contains(note.Body, "reason=account-warning") {
			sawWarning = true
		}
	}
	if !sawWarning {
		t.Fatalf("notes = %+v", notes)
	}

	other := msg
	other.SenderID = "sender-synthetic-9"
	other.SenderAccountID = 99
	other.Token = mint(t, other.Exact, other.Campaign, "", 99, rig.clock.Now())
	_, err = rig.ch.Send(context.Background(), other)
	if !errors.Is(err, ErrAccountWarning) {
		t.Fatalf("other account: %v", err)
	}
	if rig.http.count() != 2 {
		t.Fatalf("other account calls = %d", rig.http.count())
	}
}

func TestHeyReachOrdinaryFailureDoesNotPause(t *testing.T) {
	rig := newHeyRig(nil, http.StatusForbidden, `{"errorMessage":"bad key"}`)
	defer rig.http.srv.Close()
	msg := rig.approved(t, CampaignMode{})
	if _, err := rig.ch.Send(context.Background(), msg); !errors.Is(err, ErrDelivery) {
		t.Fatal("expected delivery failure")
	}
	rig.http.mu.Lock()
	rig.http.status = http.StatusOK
	rig.http.payload = `{"ok":true}`
	rig.http.mu.Unlock()
	msg.Token = mint(t, msg.Exact, msg.Campaign, "", 42, rig.clock.Now())
	if _, err := rig.ch.Send(context.Background(), msg); err != nil {
		t.Fatalf("retry: %v", err)
	}
}

func TestHeyReachDoesNotFollowRedirects(t *testing.T) {
	rig := newHeyRig(nil, http.StatusFound, "")
	defer rig.http.srv.Close()
	_, err := rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{}))
	if !errors.Is(err, ErrDelivery) {
		t.Fatalf("error = %v", err)
	}
	if rig.http.count() != 1 {
		t.Fatalf("calls = %d", rig.http.count())
	}
}

func TestHeyReachRejectsNonOfficialHostAtConstruction(t *testing.T) {
	for _, base := range []string{
		"https://example.com",
		"http://api.heyreach.io",
		"https://user:pass@api.heyreach.io",
		"https://api.heyreach.io.evil.com",
		"https://evilheyreach.io",
	} {
		_, err := NewHeyReach(HeyReachConfig{Env: NewEnviron(map[string]string{
			"HEYREACH_BASE_URL": base,
			"HEYREACH_API_KEY":  syntheticAPIKey,
		}), TokenKey: tokenKey()})
		if !errors.Is(err, ErrConfig) {
			t.Fatalf("%s: %v", base, err)
		}
	}
	ch, err := NewHeyReach(HeyReachConfig{Env: NewEnviron(map[string]string{
		"HEYREACH_BASE_URL": "https://api.heyreach.io",
		"HEYREACH_API_KEY":  syntheticAPIKey,
	}), TokenKey: tokenKey()})
	if err != nil || ch == nil || ch.testOverride {
		t.Fatalf("official host: ch=%v err=%v", ch, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func (c *manualClock) Set(now time.Time) {
	c.mu.Lock()
	c.now = now
	c.mu.Unlock()
}
