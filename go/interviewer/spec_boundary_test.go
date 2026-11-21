package interviewer_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/go/interviewer"
)

// Forge check: spec boundaries. Eligibility, consent, flag values, score scale,
// webhook authentication, and the advisory-only recommendation sit on the
// edges of the hand-off contract.

func TestSpecBoundary_FlagDefaultFalse(t *testing.T) {
	t.Setenv("ARIA_INTERVIEWER_ENABLED", "")
	t.Setenv("INTERVIEWER_BASE_URL", "")
	t.Setenv("INTERVIEWER_API_KEY", "")
	t.Setenv("INTERVIEWER_WEBHOOK_SECRET", "")
	cfg := interviewer.ConfigFromEnv()
	if cfg.Enabled {
		t.Fatal("empty flag enabled the adapter")
	}
	if cfg.HTTPTimeout != 5*time.Second {
		t.Fatalf("timeout %s", cfg.HTTPTimeout)
	}

	for _, raw := range []string{"false", "0", "no", "off", "yes", " true ", "TRUE "} {
		t.Setenv("ARIA_INTERVIEWER_ENABLED", raw)
		if interviewer.ConfigFromEnv().Enabled {
			t.Fatalf("%q enabled the adapter", raw)
		}
	}
	for _, raw := range []string{"true", "TRUE", "True", "1"} {
		t.Setenv("ARIA_INTERVIEWER_ENABLED", raw)
		cfg := interviewer.ConfigFromEnv()
		if !cfg.Enabled {
			t.Fatalf("%q did not enable the adapter", raw)
		}
	}
	t.Setenv("INTERVIEWER_BASE_URL", "https:"+"//interviewer.invalid")
	t.Setenv("INTERVIEWER_API_KEY", "test-interviewer-key")
	t.Setenv("INTERVIEWER_WEBHOOK_SECRET", "test-webhook-secret")
	t.Setenv("ARIA_INTERVIEWER_ENABLED", "true")
	cfg = interviewer.ConfigFromEnv()
	if cfg.BaseURL == "" || cfg.APIKey != "test-interviewer-key" || cfg.WebhookSecret != "test-webhook-secret" {
		t.Fatalf("env config %+v", cfg)
	}
}

func TestSpecBoundary_DefaultAttemptTimeoutIsBounded(t *testing.T) {
	calls := 0
	svc := interviewer.New(interviewer.Config{
		BaseURL:       "http:" + "//127.0.0.1",
		APIKey:        "test-interviewer-key",
		WebhookSecret: "test-webhook-secret",
		Enabled:       true,
	}, interviewer.WithTransport(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		deadline, ok := r.Context().Deadline()
		if !ok {
			t.Fatal("attempt has no deadline")
		}
		wait := time.Until(deadline)
		if wait < 4*time.Second || wait > 6*time.Second {
			t.Fatalf("attempt deadline %s", wait)
		}
		if r.URL.RawQuery != "" || r.URL.User != nil {
			t.Fatal("request leaked credentials into the URL")
		}
		return nil, errors.New("boom")
	})))
	_, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if calls != 1 {
		t.Fatalf("non-timeout transport error retried: %d", calls)
	}
	if !errors.Is(err, interviewer.ErrInfra) {
		t.Fatalf("err %v", err)
	}
}

func TestSpecBoundary_Eligibility(t *testing.T) {
	calls := 0
	svc := interviewer.New(enabledConfig("http:"+"//127.0.0.1"), interviewer.WithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("should not be called")
	})))
	cases := []struct {
		name  string
		apply func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need)
	}{
		{name: "wrong stage", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.Stage = interviewer.StageToAssess
			return c, n
		}},
		{name: "padded stage", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.Stage = "to_interview "
			return c, n
		}},
		{name: "cased stage", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.Stage = "To_Interview"
			return c, n
		}},
		{name: "no approval", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.HumanApprovalRecorded = false
			return c, n
		}},
		{name: "blank approval id", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.ApprovalID = " "
			return c, n
		}},
		{name: "consent false", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.Consent = false
			return c, n
		}},
		{name: "blank candidate", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.ID = ""
			return c, n
		}},
		{name: "blank language", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.Language = ""
			return c, n
		}},
		{name: "short language", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.Language = "e"
			return c, n
		}},
		{name: "long language", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			c.Language = strings.Repeat("a", 36)
			return c, n
		}},
		{name: "blank summary", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			n.Summary = "  "
			return c, n
		}},
		{name: "no questions", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			n.RoleQuestions = nil
			return c, n
		}},
		{name: "blank question", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			n.RoleQuestions = []string{"  "}
			return c, n
		}},
		{name: "too many questions", apply: func(c interviewer.Candidate, n interviewer.Need) (interviewer.Candidate, interviewer.Need) {
			n.RoleQuestions = make([]string, 21)
			for i := range n.RoleQuestions {
				n.RoleQuestions[i] = "synthetic"
			}
			return c, n
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cand, nd := tc.apply(validCandidate(), validNeed())
			h, err := svc.RequestScreening(context.Background(), cand, nd)
			if !errors.Is(err, interviewer.ErrValidation) {
				t.Fatalf("err %v", err)
			}
			if h.State != interviewer.StateNotRequested {
				t.Fatalf("state %s", h.State)
			}
			assertAdvisory(t, h, cand.Stage)
		})
	}
	if calls != 0 {
		t.Fatalf("calls %d", calls)
	}
}

func TestSpecBoundary_LanguageAndQuestionEdgesAccepted(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	cand := validCandidate()
	cand.Language = "en-US"
	need := validNeed()
	need.RoleQuestions = make([]string, 20)
	for i := range need.RoleQuestions {
		need.RoleQuestions[i] = "synthetic question"
	}
	need.Summary = strings.Repeat("s", 8000)
	h, err := svc.RequestScreening(context.Background(), cand, need)
	if err != nil {
		t.Fatal(err)
	}
	if h.State != interviewer.StateRequested {
		t.Fatalf("state %s", h.State)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)

	long := validNeed()
	long.Summary = strings.Repeat("s", 8001)
	if _, err := svc.RequestScreening(context.Background(), validCandidate(), long); !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("overlong summary err %v", err)
	}
}

func TestSpecBoundary_NonInterviewStages(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:"+"//127.0.0.1"), interviewer.WithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("called")
		return nil, nil
	})))
	for _, stage := range allStages() {
		if stage == interviewer.StageToInterview {
			continue
		}
		cand := validCandidate()
		cand.Stage = stage
		h, err := svc.RequestScreening(context.Background(), cand, validNeed())
		if !errors.Is(err, interviewer.ErrValidation) {
			t.Fatalf("stage %s err %v", stage, err)
		}
		assertAdvisory(t, h, stage)
	}
}

func TestSpecBoundary_BaseURL(t *testing.T) {
	ok := []string{
		"https:" + "//interviewer.example",
		"https:" + "//interviewer.example/ignored",
		"http:" + "//127.0.0.1:9",
		"http:" + "//localhost",
		"http:" + "//[::1]:9",
	}
	for _, raw := range ok {
		if err := interviewer.ValidateBaseURL(raw); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
	}
	bad := []string{
		"",
		"http:" + "//example.com",
		"https:" + "//user:pass@interviewer.example",
		"file:" + "///tmp/x",
		"ftp:" + "//interviewer.example",
	}
	for _, raw := range bad {
		if err := interviewer.ValidateBaseURL(raw); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	calls := 0
	svc := interviewer.New(interviewer.Config{
		BaseURL: "http:" + "//example.com",
		APIKey:  "test-interviewer-key",
		Enabled: true,
	}, interviewer.WithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("dialed")
	})))
	if _, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed()); !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if calls != 0 {
		t.Fatal("non-loopback http was dialed")
	}
}

func TestSpecBoundary_MissingCredentialsDoNotDial(t *testing.T) {
	calls := 0
	svc := interviewer.New(interviewer.Config{
		BaseURL: "http:" + "//127.0.0.1",
		Enabled: true,
	}, interviewer.WithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("dialed")
	})))
	if _, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed()); !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if calls != 0 {
		t.Fatal("missing api key still dialed")
	}
}

func TestSpecBoundary_NilAndCanceledContext(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	if _, err := svc.RequestScreening(nil, validCandidate(), validNeed()); !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("nil ctx err %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h, err := svc.RequestScreening(ctx, validCandidate(), validNeed())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
	if errors.Is(err, interviewer.ErrInfra) {
		t.Fatal("cancel classified as infra")
	}
	if fake.hits() != 0 {
		t.Fatalf("hits %d", fake.hits())
	}
	if h.State != interviewer.StateNotRequested {
		t.Fatalf("state %s", h.State)
	}
}

func TestSpecBoundary_RemoteStatuses(t *testing.T) {
	want := map[string]interviewer.State{
		"requested":   interviewer.StateRequested,
		"planned":     interviewer.StateRequested,
		"in_progress": interviewer.StateInProgress,
		"active":      interviewer.StateInProgress,
		"completed":   interviewer.StateCompleted,
		"failed":      interviewer.StateFailed,
		"abandoned":   interviewer.StateFailed,
		"expired":     interviewer.StateExpired,
	}
	for raw, state := range want {
		got, err := interviewer.StateFromRemote(raw)
		if err != nil || got != state {
			t.Fatalf("%s -> %s err %v", raw, got, err)
		}
	}
	for _, raw := range []string{"", "Completed", "Requested", "rejected", "withdrawn"} {
		if _, err := interviewer.StateFromRemote(raw); !errors.Is(err, interviewer.ErrValidation) {
			t.Fatalf("%q err %v", raw, err)
		}
	}
}

func TestSpecBoundary_UnauthorizedIsNotRetried(t *testing.T) {
	fake := newFake(t, "other-key")
	cfg := enabledConfig(fake.url())
	cfg.APIKey = "test-interviewer-key"
	svc := interviewer.New(cfg)
	h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if !errors.Is(err, interviewer.ErrRemote) {
		t.Fatalf("err %v", err)
	}
	if errors.Is(err, interviewer.ErrInfra) {
		t.Fatal("401 classified as infra")
	}
	if fake.hits() != 1 {
		t.Fatalf("hits %d", fake.hits())
	}
	if h.State != interviewer.StateNotRequested {
		t.Fatalf("state %s", h.State)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func TestSpecBoundary_ServerErrorRetriesOnceThenInfra(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	fake.forceStatus = http.StatusInternalServerError
	svc := interviewer.New(enabledConfig(fake.url()))
	h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if !errors.Is(err, interviewer.ErrInfra) {
		t.Fatalf("err %v", err)
	}
	if fake.postHits() != 2 {
		t.Fatalf("posts %d", fake.postHits())
	}
	if h.State != interviewer.StateNotRequested {
		t.Fatalf("state %s", h.State)
	}
}

func TestSpecBoundary_ClientErrorIsNotRetried(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	fake.forceStatus = http.StatusBadRequest
	svc := interviewer.New(enabledConfig(fake.url()))
	_, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if !errors.Is(err, interviewer.ErrRemote) {
		t.Fatalf("err %v", err)
	}
	if errors.Is(err, interviewer.ErrInfra) {
		t.Fatal("400 classified as infra")
	}
	if fake.hits() != 1 {
		t.Fatalf("hits %d", fake.hits())
	}
}

func TestSpecBoundary_RedirectNotFollowed(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	fake.redirect = true
	svc := interviewer.New(enabledConfig(fake.url()))
	h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if err == nil {
		t.Fatal("redirect treated as success")
	}
	if h.State != interviewer.StateNotRequested {
		t.Fatalf("state %s", h.State)
	}
	if fake.hits() != 1 {
		t.Fatalf("hits %d", fake.hits())
	}
}

func TestSpecBoundary_BasePathIgnored(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url() + "/ignored"))
	h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if err != nil {
		t.Fatal(err)
	}
	if h.State != interviewer.StateRequested || fake.creates() != 1 {
		t.Fatalf("state %s creates %d", h.State, fake.creates())
	}
}

func TestSpecBoundary_WebhookSignature(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	body := completedBody("scr-synthetic-1", "hire")
	sig := signBody("test-webhook-secret", body)

	if _, err := svc.AcceptWebhook(context.Background(), current, body, ""); !errors.Is(err, interviewer.ErrSignature) {
		t.Fatalf("missing sig err %v", err)
	}
	if _, err := svc.AcceptWebhook(context.Background(), current, body, "sha256="+strings.Repeat("ab", 32)); !errors.Is(err, interviewer.ErrSignature) {
		t.Fatal("wrong digest accepted")
	}
	if !interviewer.VerifySignature("test-webhook-secret", body, "sha256="+sig) {
		t.Fatal("prefixed signature rejected")
	}
	if interviewer.VerifySignature("", body, sig) {
		t.Fatal("empty secret accepted")
	}
	if interviewer.VerifySignature("test-webhook-secret", body, strings.Repeat("a", 300)) {
		t.Fatal("oversized signature accepted")
	}
	h, err := svc.AcceptWebhook(context.Background(), current, body, strings.ToUpper(sig))
	if err != nil {
		t.Fatal(err)
	}
	if h.State != interviewer.StateCompleted || h.Report == nil || !h.Report.Advisory {
		t.Fatalf("handoff %+v", h)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)

	off := interviewer.New(interviewer.Config{Enabled: false, WebhookSecret: "test-webhook-secret"})
	got, err := off.AcceptWebhook(context.Background(), current, body, sig)
	if !errors.Is(err, interviewer.ErrDisabled) {
		t.Fatalf("disabled err %v", err)
	}
	if got.State != current.State || got.Report != nil {
		t.Fatalf("disabled webhook applied: %+v", got)
	}
}

func TestSpecBoundary_WebhookDoesNotSkipRequest(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	body := completedBody("scr-synthetic-1", "hire")
	current := interviewer.Handoff{State: interviewer.StateNotRequested, Stage: interviewer.StageToInterview}
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if !errors.Is(err, interviewer.ErrTransition) {
		t.Fatalf("err %v", err)
	}
	if h.State != interviewer.StateNotRequested || h.Report != nil {
		t.Fatalf("handoff %+v", h)
	}
}

func TestSpecBoundary_WebhookIDMismatch(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	body := completedBody("scr-other", "hire")
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if h.State != interviewer.StateRequested || h.Report != nil {
		t.Fatalf("handoff %+v", h)
	}
}

func TestSpecBoundary_LiveScorecardShape(t *testing.T) {
	payload := map[string]any{
		"id":           "scr-synthetic-1",
		"status":       "completed",
		"interview_id": "iv-synthetic-001",
		"competencies": map[string]any{
			"Content":         map[string]any{"score": 5, "reasoning": "synthetic"},
			"Communication":   map[string]any{"score": 5, "reasoning": "synthetic"},
			"Problem-Solving": map[string]any{"score": 4, "reasoning": "synthetic"},
			"Confidence":      map[string]any{"score": 4, "reasoning": "synthetic"},
			"Culture Fit":     map[string]any{"score": 4, "reasoning": "synthetic"},
		},
		"overall": 4.4,
		"verdict": "Strong Qualify",
		"summary": "Synthetic scorecard.",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	current := interviewer.Handoff{
		State:       interviewer.StateInProgress,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if err != nil {
		t.Fatal(err)
	}
	if h.Report == nil || h.Report.Recommendation != "strong_hire" || h.Report.TranscriptRef != "interviews/iv-synthetic-001" || !h.Report.Advisory {
		t.Fatalf("report %#v", h.Report)
	}
	content, ok := scoreNamed(h.Report, "Content")
	if !ok || content.Value != 5 {
		t.Fatalf("content %#v", content)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func TestSpecBoundary_VerdictMapAndUnknown(t *testing.T) {
	cases := map[string]string{
		"Strong Qualify": "strong_hire",
		"Qualify":        "hire",
		"Borderline":     "lean_hire",
		"Not Qualified":  "no_hire",
	}
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	for verdict, rec := range cases {
		payload := map[string]any{
			"id":             "scr-synthetic-1",
			"status":         "completed",
			"transcript_ref": "interviews/iv-synthetic-001",
			"scores": map[string]any{
				"Content": map[string]any{"score": 3, "reasoning": "synthetic"},
			},
			"verdict": verdict,
			"summary": "Synthetic.",
		}
		body, _ := json.Marshal(payload)
		h, err := svc.AcceptWebhook(context.Background(), interviewer.Handoff{
			State:       interviewer.StateRequested,
			ScreeningID: "scr-synthetic-1",
			Stage:       interviewer.StageToInterview,
		}, body, signBody("test-webhook-secret", body))
		if err != nil {
			t.Fatalf("%s: %v", verdict, err)
		}
		if h.Report.Recommendation != rec {
			t.Fatalf("%s -> %s", verdict, h.Report.Recommendation)
		}
	}
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"scores":         map[string]any{"Content": map[string]any{"score": 3, "reasoning": "synthetic"}},
		"verdict":        "nonsense",
	}
	body, _ := json.Marshal(payload)
	_, err := svc.AcceptWebhook(context.Background(), interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}, body, signBody("test-webhook-secret", body))
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("unknown verdict err %v", err)
	}
}

func TestSpecBoundary_ScoreScale(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	for _, score := range []any{0, 5, 4.0} {
		payload := map[string]any{
			"id":             "scr-synthetic-1",
			"status":         "completed",
			"transcript_ref": "interviews/iv-synthetic-001",
			"scores":         map[string]any{"Content": map[string]any{"score": score, "reasoning": "synthetic"}},
			"recommendation": "hire",
		}
		body, _ := json.Marshal(payload)
		h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
		if err != nil {
			t.Fatalf("score %v: %v", score, err)
		}
		got, ok := scoreNamed(h.Report, "Content")
		if !ok || got.Value < 0 || got.Value > 5 {
			t.Fatalf("score %v stored %#v", score, got)
		}
	}
	for _, score := range []any{-1, 6, 4.5} {
		payload := map[string]any{
			"id":             "scr-synthetic-1",
			"status":         "completed",
			"transcript_ref": "interviews/iv-synthetic-001",
			"scores":         map[string]any{"Content": map[string]any{"score": score, "reasoning": "synthetic"}},
			"recommendation": "hire",
		}
		body, _ := json.Marshal(payload)
		h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
		if !errors.Is(err, interviewer.ErrValidation) {
			t.Fatalf("score %v err %v", score, err)
		}
		if h.State != interviewer.StateRequested || h.Report != nil {
			t.Fatalf("bad score applied: %+v", h)
		}
	}
}

func TestSpecBoundary_TranscriptRef(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "https:" + "//evil.example/secret",
		"scores":         map[string]any{"Content": map[string]any{"score": 3, "reasoning": "synthetic"}},
		"recommendation": "hire",
	}
	body, _ := json.Marshal(payload)
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if h.Report != nil {
		t.Fatal("url transcript stored")
	}
}

func TestSpecBoundary_RemoteCannotAutoReject(t *testing.T) {
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"scores":         map[string]any{"Content": map[string]any{"score": 1, "reasoning": "synthetic"}},
		"recommendation": "strong_no_hire",
		"advisory":       false,
		"auto_reject":    true,
		"stage":          "rejected",
	}
	body, _ := json.Marshal(payload)
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	h, err := svc.AcceptWebhook(context.Background(), interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}, body, signBody("test-webhook-secret", body))
	if err != nil {
		t.Fatal(err)
	}
	if h.Report == nil || !h.Report.Advisory || h.Report.Recommendation != "strong_no_hire" {
		t.Fatalf("report %#v", h.Report)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func TestSpecBoundary_CompletedIsImmutable(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	firstBody := completedBody("scr-synthetic-1", "hire")
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	done, err := svc.AcceptWebhook(context.Background(), current, firstBody, signBody("test-webhook-secret", firstBody))
	if err != nil {
		t.Fatal(err)
	}
	second := completedBody("scr-synthetic-1", "no_hire")
	h, err := svc.AcceptWebhook(context.Background(), done, second, signBody("test-webhook-secret", second))
	if err == nil {
		t.Fatal("recommendation changed after completion")
	}
	if h.Report == nil || h.Report.Recommendation != "hire" || h.State != interviewer.StateCompleted {
		t.Fatalf("handoff %+v", h)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)

	again, err := svc.AcceptWebhook(context.Background(), done, firstBody, signBody("test-webhook-secret", firstBody))
	if err != nil {
		t.Fatal(err)
	}
	if again.Report.Recommendation != "hire" {
		t.Fatalf("replay %#v", again.Report)
	}
}

func TestSpecBoundary_TerminalBackwardMoveRejected(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if err != nil {
		t.Fatal(err)
	}
	fake.setStatus(h.ScreeningID, "completed", map[string]any{
		"scores":         map[string]any{"Content": map[string]any{"score": 4, "reasoning": "synthetic"}},
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "hire",
	})
	done, err := svc.Poll(context.Background(), h)
	if err != nil {
		t.Fatal(err)
	}
	fake.setStatus(h.ScreeningID, "active", nil)
	back, err := svc.Poll(context.Background(), done)
	if !errors.Is(err, interviewer.ErrTransition) {
		t.Fatalf("err %v", err)
	}
	if back.State != interviewer.StateCompleted || back.Report == nil || back.Report.Recommendation != "hire" {
		t.Fatalf("handoff %+v", back)
	}
	assertAdvisory(t, back, interviewer.StageToInterview)
}

func TestSpecBoundary_ExpiredAndAbandonedDoNotReject(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	for _, status := range []string{"expired", "abandoned"} {
		cand := validCandidate()
		cand.ApprovalID = "apr-synthetic-" + status
		h, err := svc.RequestScreening(context.Background(), cand, validNeed())
		if err != nil {
			t.Fatal(err)
		}
		fake.setStatus(h.ScreeningID, status, nil)
		got, err := svc.Poll(context.Background(), h)
		if err != nil {
			t.Fatalf("%s: %v", status, err)
		}
		want := interviewer.StateExpired
		if status == "abandoned" {
			want = interviewer.StateFailed
		}
		if got.State != want || got.Report != nil {
			t.Fatalf("%s handoff %+v", status, got)
		}
		assertAdvisory(t, got, interviewer.StageToInterview)
	}
}

func TestSpecBoundary_OversizedWebhook(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	body := bytes.Repeat([]byte("a"), (1<<20)+1)
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if h.State != interviewer.StateRequested {
		t.Fatalf("state %s", h.State)
	}
}

func TestSpecBoundary_EmptySignedBody(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	body := []byte{}
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if h.State != interviewer.StateRequested {
		t.Fatalf("state %s", h.State)
	}
}

func TestSpecBoundary_NeverLogsSecrets(t *testing.T) {
	const (
		key     = "sentinel-api-key"
		secret  = "sentinel-webhook-secret"
		summary = "sentinel-need-summary"
	)
	fake := newFake(t, key)
	fake.forceStatus = http.StatusInternalServerError
	log := &bufLog{}
	svc := interviewer.New(interviewer.Config{
		BaseURL:       fake.url(),
		APIKey:        key,
		WebhookSecret: secret,
		Enabled:       true,
	}, interviewer.WithLogger(log))
	need := validNeed()
	need.Summary = summary
	_, err := svc.RequestScreening(context.Background(), validCandidate(), need)
	if !errors.Is(err, interviewer.ErrInfra) {
		t.Fatalf("err %v", err)
	}
	out := log.String() + err.Error()
	for _, needle := range []string{key, secret, summary} {
		if strings.Contains(out, needle) {
			t.Fatalf("leaked %q", needle)
		}
	}
}

func TestSpecBoundary_HMACUsesConstantTimeCompare(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	dir := filepath.Dir(file)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var src strings.Builder
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		src.Write(body)
	}
	text := src.String()
	if !strings.Contains(text, "subtle.ConstantTimeCompare") {
		t.Fatal("webhook verification must use subtle.ConstantTimeCompare")
	}
}

func TestSpecBoundary_HeaderNames(t *testing.T) {
	if interviewer.SignatureHeader != "X-Interviewer-Signature" {
		t.Fatal(interviewer.SignatureHeader)
	}
	if interviewer.IdempotencyHeader != "Idempotency-Key" {
		t.Fatal(interviewer.IdempotencyHeader)
	}
}

func TestSpecBoundary_PollWithoutRequest(t *testing.T) {
	calls := 0
	svc := interviewer.New(enabledConfig("http:"+"//127.0.0.1"), interviewer.WithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, io.EOF
	})))
	h, err := svc.Poll(context.Background(), interviewer.Handoff{
		State: interviewer.StateNotRequested,
		Stage: interviewer.StageToInterview,
	})
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if calls != 0 || h.State != interviewer.StateNotRequested {
		t.Fatalf("calls %d state %s", calls, h.State)
	}
}

func TestSpecBoundary_ZeroDecisionIsAdvisory(t *testing.T) {
	if (interviewer.Handoff{}).Decision() != interviewer.DecisionAdvisory {
		t.Fatal("zero handoff is not advisory")
	}
}
