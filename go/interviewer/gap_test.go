package interviewer_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/interviewer"
)

// Gaps the original suite did not pin: contact shapes that survive the
// scrubber, scorecard values the 0–5 scale cannot mean, and the flag-off
// short-circuit.

func TestGap_ContactShapesAreScrubbedBeforeSend(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	need := validNeed()
	need.Summary = "Call +1(415)555-0130 or +33 6 12 34 56 78. Start 2026-11-25. Synthetic role."
	need.RoleQuestions = []string{
		"Brief at //example.com/private or mailto:pat.synthetic@example.com",
		"Ring (415)555-0199, 4155550130, or 00 44 20 7946 0958",
	}
	if _, err := svc.RequestScreening(context.Background(), validCandidate(), need); err != nil {
		t.Fatal(err)
	}
	body, _ := fake.lastPost()
	raw := string(body)
	for _, needle := range []string{
		"415", "555", "0130", "0199", "7946", "0958", "56 78",
		"example.com", "pat.synthetic", "mailto:",
	} {
		if strings.Contains(raw, needle) {
			t.Fatalf("screening body still contains %q\n%s", needle, raw)
		}
	}
	if !strings.Contains(raw, "Synthetic role") || !strings.Contains(raw, "2026-11-25") {
		t.Fatalf("scrubber ate ordinary text: %s", raw)
	}
}

func TestGap_ReportScrubsNamesAndTightPhones(t *testing.T) {
	summary := "Reach +1 (415) 555-0130 today"
	reasoning := "Also +44(0)20 7946 0958"
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "hire",
		"summary":        summary,
		"scores": map[string]any{
			"pat.synthetic@example.com": map[string]any{"score": 3, "reasoning": reasoning},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	h, err := acceptWebhook(body)
	if err != nil {
		t.Fatal(err)
	}
	if h.Report == nil || len(h.Report.Scores) != 1 {
		t.Fatalf("report %#v", h.Report)
	}
	stored := h.Report.Summary + "\n" + h.Report.Scores[0].Name + "\n" + h.Report.Scores[0].Reasoning
	for _, needle := range []string{"pat.synthetic@example.com", "415", "555", "0130", "7946", "0958", "@"} {
		if strings.Contains(stored, needle) {
			t.Fatalf("stored report still contains %q\n%s", needle, stored)
		}
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func TestGap_MissingScoreIsNotZero(t *testing.T) {
	current := requestedHandoff()
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	cases := []map[string]any{
		{"reasoning": "synthetic"},
		{"score": nil, "reasoning": "synthetic"},
	}
	for _, score := range cases {
		payload := map[string]any{
			"id":             "scr-synthetic-1",
			"status":         "completed",
			"transcript_ref": "interviews/iv-synthetic-001",
			"recommendation": "hire",
			"scores":         map[string]any{"Content": score},
		}
		body, _ := json.Marshal(payload)
		h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
		if !errors.Is(err, interviewer.ErrValidation) {
			t.Fatalf("score %#v err %v", score, err)
		}
		if h.State != interviewer.StateRequested || h.Report != nil {
			t.Fatalf("missing score applied: %+v", h)
		}
	}
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "hire",
		"scores":         map[string]any{"Content": map[string]any{"score": 0, "reasoning": "not tested"}},
	}
	body, _ := json.Marshal(payload)
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if err != nil {
		t.Fatal(err)
	}
	got, ok := scoreNamed(h.Report, "Content")
	if !ok || got.Value != 0 {
		t.Fatalf("explicit zero %#v", got)
	}
}

func TestGap_OverallStaysOnScoreScale(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	current := requestedHandoff()
	for _, overall := range []any{-1, 5.1, 7.2, 100, nil} {
		body := overallBody(t, overall)
		h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
		if !errors.Is(err, interviewer.ErrValidation) {
			t.Fatalf("overall %v err %v handoff %+v", overall, err, h)
		}
		if h.Report != nil || h.State != interviewer.StateRequested {
			t.Fatalf("overall %v applied %+v", overall, h)
		}
	}
	for _, overall := range []any{0, 4.4, 5} {
		body := overallBody(t, overall)
		h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
		if err != nil {
			t.Fatalf("overall %v: %v", overall, err)
		}
		if h.Report == nil || h.Report.Overall < 0 || h.Report.Overall > 5 {
			t.Fatalf("overall %v stored %#v", overall, h.Report)
		}
	}
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "hire",
		"scores":         map[string]any{"Content": map[string]any{"score": 4, "reasoning": "synthetic"}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	h, err := svc.AcceptWebhook(context.Background(), current, body, signBody("test-webhook-secret", body))
	if err != nil || h.Report == nil {
		t.Fatalf("omitted overall %#v err %v", h.Report, err)
	}
}

func TestGap_MalformedScoreStillRejected(t *testing.T) {
	payload := map[string]any{
		"id":     "scr-synthetic-1",
		"status": "active",
		"scores": map[string]any{"Content": map[string]any{"score": "4", "reasoning": "synthetic"}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	h, err := acceptWebhook(body)
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if h.State != interviewer.StateRequested || h.Report != nil {
		t.Fatalf("malformed score applied: %+v", h)
	}
}

func TestGap_UnknownVerdictRejectedBesideRecommendation(t *testing.T) {
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "hire",
		"verdict":        "pat.synthetic@example.com",
		"scores":         map[string]any{"Content": map[string]any{"score": 3, "reasoning": "synthetic"}},
	}
	body, _ := json.Marshal(payload)
	h, err := acceptWebhook(body)
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("err %v", err)
	}
	if h.Report != nil || h.State != interviewer.StateRequested {
		t.Fatalf("unknown verdict stored: %+v", h)
	}
}

func TestGap_VerdictAgreesWithRecommendation(t *testing.T) {
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "strong_hire",
		"verdict":        "Not Qualified",
		"scores":         map[string]any{"Content": map[string]any{"score": 1, "reasoning": "synthetic"}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	h, err := acceptWebhook(body)
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("contradiction err %v", err)
	}
	if h.Report != nil || h.State != interviewer.StateRequested {
		t.Fatalf("contradiction stored: %+v", h)
	}
	payload["recommendation"] = "strong_no_hire"
	body, err = json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	h, err = acceptWebhook(body)
	if err != nil || h.Report == nil || h.Report.Recommendation != "strong_no_hire" || h.Report.Verdict != "Not Qualified" {
		t.Fatalf("strong_no_hire %#v err %v", h.Report, err)
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func TestGap_RedirectIsRemoteNotInfra(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	fake.redirect = true
	svc := interviewer.New(enabledConfig(fake.url()))
	h, err := svc.RequestScreening(context.Background(), validCandidate(), validNeed())
	if !errors.Is(err, interviewer.ErrRemote) {
		t.Fatalf("err %v", err)
	}
	if errors.Is(err, interviewer.ErrInfra) {
		t.Fatal("redirect classified as infrastructure")
	}
	if h.State != interviewer.StateNotRequested || fake.hits() != 1 {
		t.Fatalf("state %s hits %d", h.State, fake.hits())
	}
	if strings.Contains(err.Error(), "test-interviewer-key") {
		t.Fatal("redirect error leaked the api key")
	}
}

func TestGap_DisabledFlagShortCircuitsNilContext(t *testing.T) {
	calls := 0
	svc := interviewer.New(interviewer.Config{
		BaseURL:       "http:" + "//127.0.0.1",
		APIKey:        "test-interviewer-key",
		WebhookSecret: "test-webhook-secret",
		Enabled:       false,
	}, interviewer.WithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("disabled flag still called")
	})))
	h, err := svc.RequestScreening(nil, validCandidate(), validNeed())
	if !errors.Is(err, interviewer.ErrDisabled) {
		t.Fatalf("request err %v", err)
	}
	if errors.Is(err, interviewer.ErrValidation) {
		t.Fatal("nil context while disabled classified as validation")
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
	current := interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
	got, err := svc.Poll(nil, current)
	if !errors.Is(err, interviewer.ErrDisabled) {
		t.Fatalf("poll err %v", err)
	}
	if got.State != current.State || got.ScreeningID != current.ScreeningID {
		t.Fatalf("poll mutated %+v", got)
	}
	if calls != 0 {
		t.Fatalf("calls %d", calls)
	}
}

func TestGap_LanguageTagAndQuestionLength(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	bad := []string{"4155550130", "12", "en--US", "123-en"}
	for _, language := range bad {
		cand := validCandidate()
		cand.Language = language
		h, err := svc.RequestScreening(context.Background(), cand, validNeed())
		if !errors.Is(err, interviewer.ErrValidation) {
			t.Fatalf("language %q err %v", language, err)
		}
		if h.State != interviewer.StateNotRequested {
			t.Fatalf("language %q state %s", language, h.State)
		}
	}
	cand := validCandidate()
	cand.Language = "es-419"
	cand.ApprovalID = "apr-synthetic-es"
	if _, err := svc.RequestScreening(context.Background(), cand, validNeed()); err != nil {
		t.Fatal(err)
	}
	long := validNeed()
	long.RoleQuestions = []string{strings.Repeat("q", 8001)}
	h, err := svc.RequestScreening(context.Background(), validCandidate(), long)
	if !errors.Is(err, interviewer.ErrValidation) {
		t.Fatalf("long question err %v", err)
	}
	if h.State != interviewer.StateNotRequested {
		t.Fatalf("state %s", h.State)
	}
	okCand := validCandidate()
	okCand.ApprovalID = "apr-synthetic-long"
	okNeed := validNeed()
	okNeed.RoleQuestions = []string{strings.Repeat("q", 8000)}
	if _, err := svc.RequestScreening(context.Background(), okCand, okNeed); err != nil {
		t.Fatal(err)
	}
	if fake.hits() != 2 {
		t.Fatalf("hits %d", fake.hits())
	}
}

func requestedHandoff() interviewer.Handoff {
	return interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}
}

func acceptWebhook(body []byte) (interviewer.Handoff, error) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	return svc.AcceptWebhook(context.Background(), requestedHandoff(), body, signBody("test-webhook-secret", body))
}

func overallBody(t *testing.T, overall any) []byte {
	t.Helper()
	payload := map[string]any{
		"id":             "scr-synthetic-1",
		"status":         "completed",
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": "hire",
		"scores":         map[string]any{"Content": map[string]any{"score": 4, "reasoning": "synthetic"}},
		"overall":        overall,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return body
}
