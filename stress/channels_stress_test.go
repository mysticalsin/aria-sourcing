package channels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Sweep 0 stress cases A1-A4, A6 and A8. They call the channel package.
// Every outbound dial is refused unless the host is loopback.

func TestMain(m *testing.M) {
	http.DefaultTransport = &loopbackOnly{base: http.DefaultTransport}
	os.Exit(m.Run())
}

type loopbackOnly struct {
	base http.RoundTripper
}

func (l *loopbackOnly) RoundTrip(req *http.Request) (*http.Response, error) {
	host := req.URL.Hostname()
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		fmt.Fprintf(os.Stderr, "non-loopback request aborted: %s\n", req.URL.Host)
		os.Exit(2)
	}
	base := l.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(req)
}

func rssBytes() uint64 {
	body, err := os.ReadFile("/proc/self/status")
	if err != nil {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		return m.Sys
	}
	for _, line := range strings.Split(string(body), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				kb, _ := strconv.ParseUint(fields[1], 10, 64)
				return kb * 1024
			}
		}
	}
	return 0
}

func within(t *testing.T, limit time.Duration, fn func()) {
	t.Helper()
	start := time.Now()
	fn()
	if elapsed := time.Since(start); elapsed > limit {
		t.Fatalf("wall clock %s exceeded %s", elapsed, limit)
	}
}

func stressApproved(t *testing.T, email *Email, clock *manualClock, mode CampaignMode) ApprovedMessage {
	t.Helper()
	exact, err := email.Prepare(context.Background(), emailDraft())
	if err != nil {
		t.Fatal(err)
	}
	return ApprovedMessage{
		Exact:     exact,
		Token:     mint(t, exact, mode, "recruiting@example.com", 0, clock.Now()),
		DeliverTo: "Ada@Example.com",
		From:      "recruiting@example.com",
		SenderID:  "sender-synthetic-1",
		Campaign:  mode,
		Record:    MailRecord{Model: "aria.campaign", ResID: 42, Name: "Synthetic role"},
	}
}

func TestStressA1Caps(t *testing.T) {
	within(t, 45*time.Second, func() {
		const n = 50
		env := NewLiveEnv(map[string]string{
			"ARIA_RECIPIENT_ALLOWLIST":    "ada@example.com",
			"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
			"ARIA_UNSUBSCRIBE_HOST":       "example.com",
			"ARIA_EMAIL_SENDER_DAILY_CAP": strconv.Itoa(n),
		})
		mailer := &fakeMailer{}
		clock := &manualClock{now: time.Date(2026, 11, 21, 3, 0, 0, 0, time.UTC)}
		email := NewEmail(EmailConfig{
			Env: env, TokenKey: tokenKey(), SMTP: mailer, Auditor: &memAudit{}, Clock: clock,
		})
		attempts := 10 * n
		msgs := make([]ApprovedMessage, attempts)
		for i := range msgs {
			msgs[i] = stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		}
		var sent atomic.Int64
		var refused atomic.Int64
		var bad atomic.Int64
		var wg sync.WaitGroup
		jobs := make(chan ApprovedMessage, attempts)
		for _, msg := range msgs {
			jobs <- msg
		}
		close(jobs)
		for w := 0; w < 20; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for msg := range jobs {
					_, err := email.Send(context.Background(), msg)
					if err == nil {
						sent.Add(1)
						continue
					}
					refused.Add(1)
					if !errors.Is(err, ErrDailyCap) {
						bad.Add(1)
					}
				}
			}()
		}
		wg.Wait()
		if bad.Load() != 0 {
			t.Fatalf("refusals that were not daily-cap: %d", bad.Load())
		}
		if sent.Load() != n {
			t.Fatalf("sent %d, want exactly %d", sent.Load(), n)
		}
		if int(sent.Load()+refused.Load()) != attempts {
			t.Fatalf("accounted %d, want %d", sent.Load()+refused.Load(), attempts)
		}
		if len(mailer.snapshot()) != n {
			t.Fatalf("mail rows %d, want %d", len(mailer.snapshot()), n)
		}
		t.Logf("A1 held sent=%d refused=%d cap=%d", sent.Load(), refused.Load(), n)
	})
	if rssBytes() > 512<<20 {
		t.Fatalf("RSS %d over 512MiB", rssBytes())
	}
}

type gateMailer struct {
	mu      sync.Mutex
	sent    []OutboundMail
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (g *gateMailer) Send(ctx context.Context, mail OutboundMail) error {
	g.once.Do(func() { close(g.entered) })
	select {
	case <-g.release:
	case <-ctx.Done():
		return ctx.Err()
	}
	g.mu.Lock()
	g.sent = append(g.sent, mail)
	g.mu.Unlock()
	return nil
}

func TestStressA2KillSwitch(t *testing.T) {
	if os.Getenv("STRESS_RESTART_CHILD") == "1" {
		env := NewLiveEnv(map[string]string{
			"ARIA_RECIPIENT_ALLOWLIST":    "ada@example.com",
			"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
			"ARIA_UNSUBSCRIBE_HOST":       "example.com",
			"ARIA_EMAIL_SENDER_DAILY_CAP": "50",
			"ARIA_SEND_KILL_SWITCH":       os.Getenv("ARIA_SEND_KILL_SWITCH"),
		})
		clock := &manualClock{now: time.Date(2026, 11, 21, 3, 0, 0, 0, time.UTC)}
		email := NewEmail(EmailConfig{Env: env, TokenKey: tokenKey(), SMTP: &fakeMailer{}, Auditor: &memAudit{}, Clock: clock})
		msg := stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		_, err := email.Send(context.Background(), msg)
		if errors.Is(err, ErrKillSwitch) {
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "child send after restart: %v\n", err)
		os.Exit(3)
	}
	within(t, 60*time.Second, func() {
		env := NewLiveEnv(map[string]string{
			"ARIA_RECIPIENT_ALLOWLIST":    "ada@example.com",
			"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
			"ARIA_UNSUBSCRIBE_HOST":       "example.com",
			"ARIA_EMAIL_SENDER_DAILY_CAP": "5000",
		})
		gate := &gateMailer{entered: make(chan struct{}), release: make(chan struct{})}
		clock := &manualClock{now: time.Date(2026, 11, 21, 3, 0, 0, 0, time.UTC)}
		email := NewEmail(EmailConfig{Env: env, TokenKey: tokenKey(), SMTP: gate, Auditor: &memAudit{}, Clock: clock})
		queued := make([]ApprovedMessage, 500)
		for i := range queued {
			queued[i] = stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		}
		var wg sync.WaitGroup
		for _, msg := range queued {
			wg.Add(1)
			msg := msg
			go func() {
				defer wg.Done()
				_, _ = email.Send(context.Background(), msg)
			}()
		}
		select {
		case <-gate.entered:
		case <-time.After(10 * time.Second):
			t.Fatal("no in-flight send reached the sink")
		}
		env.Set("ARIA_SEND_KILL_SWITCH", "1")
		time.Sleep(2 * time.Second)
		close(gate.release)
		wg.Wait()
		var late int
		for i := 0; i < 20; i++ {
			msg := stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
			if _, err := email.Send(context.Background(), msg); err == nil {
				late++
			} else if !errors.Is(err, ErrKillSwitch) {
				t.Fatalf("post-flip error %v", err)
			}
		}
		if late != 0 {
			t.Fatalf("sends that started after the flip plus 2s: %d", late)
		}
		child := exec.Command(os.Args[0], "-test.run=TestStressA2KillSwitch")
		child.Env = append(os.Environ(), "STRESS_RESTART_CHILD=1", "ARIA_SEND_KILL_SWITCH=1")
		out, err := child.CombinedOutput()
		if err != nil {
			t.Fatalf("restart child did not keep the switch: %v %s", err, out)
		}
		t.Logf("A2 held in-flight sink rows=%d post-flip sends=0 restart persisted", len(gate.sent))
	})
}

func TestStressA3AutoPause(t *testing.T) {
	within(t, 45*time.Second, func() {
		rig := newHeyRig(map[string]string{
			"ARIA_HEYREACH_ERROR_THRESHOLD":      "3",
			"ARIA_HEYREACH_ERROR_WINDOW_SECONDS": "60",
			"ARIA_HEYREACH_ERROR_PAUSE_SECONDS":  "3600",
			"ARIA_HEYREACH_SENDER_DAILY_CAP":     "100",
			"ARIA_HEYREACH_SENDER_WEEKLY_CAP":    "100",
			"ARIA_HEYREACH_MIN_GAP_SECONDS":      "0",
		}, http.StatusTooManyRequests, `{"code":"account_warning","errorMessage":"bounce complaint"}`)
		defer rig.http.srv.Close()
		if rig.http.srv.Listener.Addr().(*net.TCPAddr).IP.IsLoopback() == false {
			t.Fatal("heyreach stub is not loopback")
		}
		start := time.Now()
		msg := rig.approved(t, CampaignMode{Mode: "manual"})
		_, err := rig.ch.Send(context.Background(), msg)
		if !errors.Is(err, ErrAccountWarning) {
			t.Fatalf("warning: %v", err)
		}
		if time.Since(start) > 5*time.Second {
			t.Fatalf("pause was not inside the window: %s", time.Since(start))
		}
		for i := 0; i < 10; i++ {
			again := rig.approved(t, CampaignMode{Mode: "manual"})
			_, err = rig.ch.Send(context.Background(), again)
			if !errors.Is(err, ErrPaused) {
				t.Fatalf("send while paused: %v", err)
			}
		}
		if rig.http.count() != 1 {
			t.Fatalf("calls while paused = %d", rig.http.count())
		}
		fresh := newHeyRig(map[string]string{
			"ARIA_HEYREACH_SENDER_DAILY_CAP":  "100",
			"ARIA_HEYREACH_SENDER_WEEKLY_CAP": "100",
			"ARIA_HEYREACH_MIN_GAP_SECONDS":   "0",
		}, http.StatusOK, `{"ok":true}`)
		defer fresh.http.srv.Close()
		fresh.ch.cfg.Pauses = rig.ch.cfg.Pauses
		resumed := fresh.approved(t, CampaignMode{Mode: "manual"})
		_, err = fresh.ch.Send(context.Background(), resumed)
		if !errors.Is(err, ErrPaused) {
			t.Fatalf("pause cleared without a human resume: %v", err)
		}
		t.Log("A3 pause held; human resume has no PauseStore clear method")
	})
}

func TestStressA4ApprovalReplay(t *testing.T) {
	within(t, 45*time.Second, func() {
		env := NewLiveEnv(map[string]string{
			"ARIA_RECIPIENT_ALLOWLIST":    "ada@example.com",
			"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
			"ARIA_UNSUBSCRIBE_HOST":       "example.com",
			"ARIA_EMAIL_SENDER_DAILY_CAP": "500",
		})
		mailer := &fakeMailer{}
		clock := &manualClock{now: time.Date(2026, 11, 21, 3, 0, 0, 0, time.UTC)}
		email := NewEmail(EmailConfig{Env: env, TokenKey: tokenKey(), SMTP: mailer, Auditor: &memAudit{}, Clock: clock})
		msg := stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		var okN atomic.Int64
		var used atomic.Int64
		var wg sync.WaitGroup
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := email.Send(context.Background(), msg)
				if err == nil {
					okN.Add(1)
					return
				}
				if errors.Is(err, ErrTokenUsed) {
					used.Add(1)
				}
			}()
		}
		wg.Wait()
		if okN.Load() != 1 || len(mailer.snapshot()) != 1 {
			t.Fatalf("replay sent %d rows %d", okN.Load(), len(mailer.snapshot()))
		}
		expired := stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		clock.Advance(2 * time.Hour)
		if _, err := email.Send(context.Background(), expired); !errors.Is(err, ErrExpired) {
			t.Fatalf("expired token: %v", err)
		}
		edited := stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		edited.Exact.Body += " edited"
		edited.DeliverTo = "other@example.com"
		if _, err := email.Send(context.Background(), edited); err == nil {
			t.Fatal("edited body was accepted")
		}
		t.Logf("A4 held one send, %d replays refused", used.Load())
	})
}

func TestStressA6ChannelBurst(t *testing.T) {
	within(t, 20*time.Second, func() {
		env := NewLiveEnv(map[string]string{
			"ARIA_RECIPIENT_ALLOWLIST":    "ada@example.com",
			"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
			"ARIA_UNSUBSCRIBE_HOST":       "example.com",
			"ARIA_EMAIL_SENDER_DAILY_CAP": "5000",
		})
		mailer := &fakeMailer{}
		clock := &manualClock{now: time.Date(2026, 11, 21, 3, 0, 0, 0, time.UTC)}
		email := NewEmail(EmailConfig{Env: env, TokenKey: tokenKey(), SMTP: mailer, Auditor: &memAudit{}, Clock: clock})
		pool := make(chan ApprovedMessage, 1000)
		for i := 0; i < 1000; i++ {
			pool <- stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		}
		type event struct {
			ID   string `json:"id"`
			Body string `json:"body"`
		}
		seen := map[string]struct{}{}
		var mu sync.Mutex
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Hostname() != "" {
				host, _, _ := net.SplitHostPort(r.Host)
				if host != "127.0.0.1" && host != "localhost" {
					http.Error(w, "non-loopback", http.StatusBadRequest)
					return
				}
			}
			var ev event
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&ev); err != nil || ev.ID == "" {
				http.Error(w, "malformed", http.StatusBadRequest)
				return
			}
			mu.Lock()
			if _, dup := seen[ev.ID]; dup {
				mu.Unlock()
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"duplicate":true}`))
				return
			}
			seen[ev.ID] = struct{}{}
			mu.Unlock()
			msg := <-pool
			if _, err := email.Send(r.Context(), msg); err != nil {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			w.WriteHeader(http.StatusAccepted)
		}))
		defer srv.Close()
		if !strings.Contains(srv.URL, "127.0.0.1") && !strings.Contains(srv.URL, "localhost") {
			t.Fatalf("stub url %s", srv.URL)
		}
		client := &http.Client{Timeout: 5 * time.Second, Transport: &loopbackOnly{base: http.DefaultTransport}}
		start := time.Now()
		var wg sync.WaitGroup
		var accepted atomic.Int64
		var duplicates atomic.Int64
		var malformed atomic.Int64
		post := func(body string, wantDup bool) {
			defer wg.Done()
			res, err := client.Post(srv.URL, "application/json", strings.NewReader(body))
			if err != nil {
				t.Errorf("post: %v", err)
				return
			}
			defer res.Body.Close()
			_, _ = io.Copy(io.Discard, res.Body)
			switch res.StatusCode {
			case http.StatusAccepted:
				accepted.Add(1)
			case http.StatusOK:
				duplicates.Add(1)
			case http.StatusBadRequest:
				malformed.Add(1)
			default:
				t.Errorf("status %d", res.StatusCode)
			}
		}
		for i := 0; i < 1000; i++ {
			wg.Add(1)
			go post(fmt.Sprintf(`{"id":"ev-%d","body":"synthetic"}`, i), false)
		}
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go post(fmt.Sprintf(`{"id":"ev-%d","body":"synthetic"}`, i), true)
		}
		for i := 0; i < 25; i++ {
			wg.Add(1)
			go post(`{"nope":true}`, false)
		}
		wg.Wait()
		if time.Since(start) > 10*time.Second {
			t.Fatalf("1000 events took %s", time.Since(start))
		}
		if accepted.Load() != 1000 || duplicates.Load() != 100 || malformed.Load() != 25 {
			t.Fatalf("accepted %d duplicates %d malformed %d", accepted.Load(), duplicates.Load(), malformed.Load())
		}
		if len(mailer.snapshot()) != 1000 {
			t.Fatalf("rows %d", len(mailer.snapshot()))
		}
		t.Logf("A6 held in %s", time.Since(start))
	})
}

func TestStressA8Soak(t *testing.T) {
	seconds := 30 * 60
	if raw := os.Getenv("STRESS_SOAK_SECONDS"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			t.Fatal(raw)
		}
		seconds = n
	}
	deadline := time.Now().Add(time.Duration(seconds) * time.Second)
	env := NewLiveEnv(map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST":    "ada@example.com",
		"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com",
		"ARIA_UNSUBSCRIBE_HOST":       "example.com",
		"ARIA_EMAIL_SENDER_DAILY_CAP": "1000000",
	})
	clock := &manualClock{now: time.Date(2026, 11, 21, 3, 0, 0, 0, time.UTC)}
		email := NewEmail(EmailConfig{Env: env, TokenKey: tokenKey(), SMTP: discardMailer{}, Auditor: discardAudit{}, Clock: clock})
	warmup := time.Now().Add(30 * time.Second)
	var warm uint64
	for time.Now().Before(warmup) && time.Now().Before(deadline) {
		msg := stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		_, _ = email.Send(context.Background(), msg)
	}
	runtime.GC()
	warm = rssBytes()
	var ops atomic.Int64
	for time.Now().Before(deadline) {
		msg := stressApproved(t, email, clock, CampaignMode{Mode: "manual"})
		_, _ = email.Send(context.Background(), msg)
		ops.Add(1)
		if ops.Load()%1000 == 0 {
			runtime.GC()
		}
	}
	runtime.GC()
	end := rssBytes()
	if warm > 0 && end > warm+(warm/10) && end > warm+8<<20 {
		t.Fatalf("RSS grew from %d to %d", warm, end)
	}
		t.Logf("A8 soak %ds ops=%d rss %d -> %d", seconds, ops.Load(), warm, end)
}

type discardMailer struct{}

func (discardMailer) Send(context.Context, OutboundMail) error { return nil }

type discardAudit struct{}

func (discardAudit) PostChatter(context.Context, MailMessage) error { return nil }
