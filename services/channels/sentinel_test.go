package channels

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSentAuditFailureDoesNotDoubleSend(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	rig.audit.failFrom = 2
	msg := rig.approved(t, CampaignMode{Mode: "manual"})
	_, err := rig.email.Send(context.Background(), msg)
	if !errors.Is(err, ErrSentAuditFailed) {
		t.Fatalf("error = %v, want sent-audit-failed", err)
	}
	if got := len(rig.mailer.snapshot()); got != 1 {
		t.Fatalf("deliveries after audit failure = %d", got)
	}
	_, err = rig.email.Send(context.Background(), msg)
	if err == nil {
		t.Fatal("retry after a recorded send was accepted")
	}
	if got := len(rig.mailer.snapshot()); got != 1 {
		t.Fatalf("retry delivered again, count = %d", got)
	}
}

func TestPacingReservationIsAtomic(t *testing.T) {
	rig := newHeyRig(map[string]string{
		"ARIA_HEYREACH_MIN_GAP_SECONDS": "120",
	}, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	base := rig.http.srv.Client().Transport
	var entered int32
	rig.ch.cfg.HTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		atomic.AddInt32(&entered, 1)
		time.Sleep(80 * time.Millisecond)
		return base.RoundTrip(r)
	})}
	first := rig.approved(t, CampaignMode{})
	second := first
	second.Token = mint(t, second.Exact, second.Campaign, "", 42, rig.clock.Now())
	errCh := make(chan error, 2)
	var wg sync.WaitGroup
	for _, msg := range []ApprovedMessage{first, second} {
		wg.Add(1)
		go func(msg ApprovedMessage) {
			defer wg.Done()
			_, err := rig.ch.Send(context.Background(), msg)
			errCh <- err
		}(msg)
	}
	wg.Wait()
	close(errCh)
	var pacing, ok int
	for err := range errCh {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrPacing):
			pacing++
		default:
			t.Errorf("error = %v", err)
		}
	}
	if ok != 1 || pacing != 1 {
		t.Fatalf("successes=%d pacing=%d entered=%d", ok, pacing, entered)
	}
	if atomic.LoadInt32(&entered) != 1 {
		t.Fatalf("transport entries = %d, want 1", entered)
	}
}

func TestKillSwitchIsReadLiveOnEachSend(t *testing.T) {
	env := NewLiveEnv(map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST":    adaRecipient,
		"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
		"ARIA_UNSUBSCRIBE_HOST":       "example.com",
		"ARIA_EMAIL_SENDER_DAILY_CAP": "10",
	})
	rig := newEmailRig(env)
	if _, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{})); err != nil {
		t.Fatal(err)
	}
	env.Set("ARIA_SEND_KILL_SWITCH", "yes")
	_, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{}))
	if !errors.Is(err, ErrKillSwitch) {
		t.Fatalf("live switch: %v", err)
	}
	if len(rig.mailer.snapshot()) != 1 {
		t.Fatal("send proceeded after the switch was engaged")
	}
	env.Set("ARIA_SEND_KILL_SWITCH", "0")
	if _, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{})); err != nil {
		t.Fatal(err)
	}
}

func TestTokenBindsModeQCAndSender(t *testing.T) {
	env := emailEnv(map[string]string{"ARIA_SENDER_ALLOWLIST": "recruiting@example.com,other@example.com"})
	rig := newEmailRig(env)
	manual := rig.approved(t, CampaignMode{Mode: "manual"})
	manual.Campaign = CampaignMode{Mode: "auto", AutoOptIn: true, QCPass: true}
	if _, err := rig.email.Send(context.Background(), manual); !errors.Is(err, ErrBinding) {
		t.Fatalf("manual token as auto: %v", err)
	}
	swapped := rig.approved(t, CampaignMode{Mode: "manual"})
	swapped.From = "other@example.com"
	if _, err := rig.email.Send(context.Background(), swapped); !errors.Is(err, ErrBinding) {
		t.Fatalf("swapped sender: %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("unbound sender or mode was delivered")
	}
	auto := rig.approved(t, CampaignMode{Mode: "auto", AutoOptIn: true, QCPass: true})
	if _, err := rig.email.Send(context.Background(), auto); err != nil {
		t.Fatal(err)
	}
}

func TestListUnsubscribeURLIsBoundInTheToken(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	msg := rig.approved(t, CampaignMode{})
	if _, err := rig.email.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	sent := rig.mailer.snapshot()
	if sent[0].Headers["List-Unsubscribe"] != "<"+unsubscribeURL+">" {
		t.Fatalf("header = %q", sent[0].Headers["List-Unsubscribe"])
	}
	other := "https://example.com/unsubscribe/other"
	msg = rig.approved(t, CampaignMode{})
	msg.Exact.UnsubscribeURL = other
	msg.Exact.Body = strings.Replace(msg.Exact.Body, unsubscribeURL, other, 1)
	msg.Exact.BodyHash = ""
	if _, err := rig.email.Send(context.Background(), msg); !errors.Is(err, ErrBinding) {
		t.Fatalf("swapped link: %v", err)
	}
}

func TestHeyReachErrorRatePauseIsPersistent(t *testing.T) {
	store := NewMemoryPauseStore()
	rig := newHeyRig(map[string]string{
		"ARIA_HEYREACH_ERROR_THRESHOLD":      "2",
		"ARIA_HEYREACH_ERROR_WINDOW_SECONDS": "3600",
		"ARIA_HEYREACH_ERROR_PAUSE_SECONDS":  "600",
	}, http.StatusInternalServerError, `{"errorMessage":"synthetic outage"}`)
	defer rig.http.srv.Close()
	rig.ch.cfg.Pauses = store
	msg := rig.approved(t, CampaignMode{})
	if _, err := rig.ch.Send(context.Background(), msg); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("first: %v", err)
	}
	msg.Token = mint(t, msg.Exact, msg.Campaign, "", 42, rig.clock.Now())
	if _, err := rig.ch.Send(context.Background(), msg); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("second: %v", err)
	}
	msg.Token = mint(t, msg.Exact, msg.Campaign, "", 42, rig.clock.Now())
	if _, err := rig.ch.Send(context.Background(), msg); !errors.Is(err, ErrPaused) {
		t.Fatalf("third: %v", err)
	}
	if rig.http.count() != 2 {
		t.Fatalf("calls = %d", rig.http.count())
	}
	again, err := newHeyReachForTest(HeyReachConfig{
		Env:      rig.ch.cfg.Env,
		TokenKey: tokenKey(),
		Auditor:  &memAudit{},
		Clock:    rig.clock,
		HTTP:     rig.http.srv.Client(),
		Pauses:   store,
	})
	if err != nil {
		t.Fatal(err)
	}
	msg.Token = mint(t, msg.Exact, msg.Campaign, "", 42, rig.clock.Now())
	if _, err := again.Send(context.Background(), msg); !errors.Is(err, ErrPaused) {
		t.Fatalf("new adapter: %v", err)
	}
	if rig.http.count() != 2 {
		t.Fatal("a new adapter ignored the pause store")
	}
}

func TestHeyReachPauseStoreBlocksBeforeDial(t *testing.T) {
	store := NewMemoryPauseStore()
	if err := store.Pause(context.Background(), senderKey(heySender), time.Time{}, "account-warning"); err != nil {
		t.Fatal(err)
	}
	rig := newHeyRig(nil, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	rig.ch.cfg.Pauses = store
	if _, err := rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{})); !errors.Is(err, ErrPaused) {
		t.Fatalf("error = %v", err)
	}
	if rig.http.count() != 0 {
		t.Fatal("paused sender called the API")
	}
}

func TestHeyReachForTestIsTheOnlyFakeHostOverride(t *testing.T) {
	_, err := NewHeyReach(HeyReachConfig{Env: NewEnviron(map[string]string{
		"HEYREACH_BASE_URL": "http://127.0.0.1:9",
	}), TokenKey: tokenKey()})
	if !errors.Is(err, ErrConfig) {
		t.Fatalf("production constructor accepted a fake host: %v", err)
	}
	_, err = newHeyReachForTest(HeyReachConfig{Env: NewEnviron(map[string]string{
		"HEYREACH_BASE_URL": "https://example.com",
	}), TokenKey: tokenKey()})
	if !errors.Is(err, ErrConfig) {
		t.Fatalf("test constructor accepted a public host: %v", err)
	}
}
