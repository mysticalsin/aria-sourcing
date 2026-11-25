package interviewer_test

import (
	"context"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/interviewer"
)

// Contact data must not leave the process in the screening body, and must not
// be stored in the advisory report. The fixtures are synthetic.

func contactNeed() interviewer.Need {
	need := validNeed()
	need.Summary = "Synthetic role for a fictional team. Email pat.synthetic@example.com or phone +1 415 555 0130. Brief " + ("https:" + "//example.com/synthetic-brief")
	need.RoleQuestions = []string{
		"Discuss the brief at " + ("www." + "example.com/q") + " or call +44 20 7946 0958",
	}
	return need
}

func TestSpecBoundary_OutboundScrubsContactData(t *testing.T) {
	fake := newFake(t, "test-interviewer-key")
	svc := interviewer.New(enabledConfig(fake.url()))
	if _, err := svc.RequestScreening(context.Background(), validCandidate(), contactNeed()); err != nil {
		t.Fatal(err)
	}
	body, _ := fake.lastPost()
	raw := string(body)
	for _, needle := range []string{
		"pat.synthetic@example.com",
		"example.com",
		"415",
		"555",
		"0130",
		"7946",
		"0958",
		"https:",
		"www.",
	} {
		if strings.Contains(raw, needle) {
			t.Fatalf("screening body still contains %q", needle)
		}
	}
	if !strings.Contains(raw, "Synthetic role") {
		t.Fatal("redaction removed the non-contact summary")
	}
	if !strings.Contains(raw, `"need_summary"`) || !strings.Contains(raw, `"role_questions"`) || !strings.Contains(raw, `"candidate_id"`) || !strings.Contains(raw, `"language"`) || !strings.Contains(raw, `"consent"`) {
		t.Fatal("allowlisted fields missing")
	}
}

func TestSpecBoundary_ReportScrubsContactData(t *testing.T) {
	svc := interviewer.New(enabledConfig("http:" + "//127.0.0.1"))
	summary := "Synthetic result for pat.synthetic@example.com via " + ("https:" + "//example.com/result")
	reasoning := "Callback +1 415 555 0199"
	body := []byte(`{"id":"scr-synthetic-1","status":"completed","transcript_ref":"interviews/iv-synthetic-001","recommendation":"hire","summary":` + jsonString(summary) + `,"scores":{"Content":{"score":3,"reasoning":` + jsonString(reasoning) + `}}}`)
	h, err := svc.AcceptWebhook(context.Background(), interviewer.Handoff{
		State:       interviewer.StateRequested,
		ScreeningID: "scr-synthetic-1",
		Stage:       interviewer.StageToInterview,
	}, body, signBody("test-webhook-secret", body))
	if err != nil {
		t.Fatal(err)
	}
	if h.Report == nil {
		t.Fatal("missing report")
	}
	stored := h.Report.Summary
	for _, score := range h.Report.Scores {
		stored += "\n" + score.Reasoning
	}
	for _, needle := range []string{"pat.synthetic@example.com", "example.com", "415", "555", "0199", "https:"} {
		if strings.Contains(stored, needle) {
			t.Fatalf("stored report still contains %q", needle)
		}
	}
	assertAdvisory(t, h, interviewer.StageToInterview)
}

func jsonString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\', '"':
			b.WriteByte('\\')
			b.WriteRune(r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}
