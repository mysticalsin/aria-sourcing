package interviewer_test

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/mysticalsin/aria-sourcing/go/interviewer"
)

func validCandidate() interviewer.Candidate {
	return interviewer.Candidate{
		ID:                    "cand-synthetic-001",
		Stage:                 interviewer.StageToInterview,
		HumanApprovalRecorded: true,
		ApprovalID:            "apr-synthetic-001",
		Language:              "en",
		Consent:               true,
	}
}

func validNeed() interviewer.Need {
	return interviewer.Need{
		ID:      "need-synthetic-001",
		Summary: "Synthetic hiring need for a fictional backend role.",
		RoleQuestions: []string{
			"Describe a synthetic service you would design.",
			"How would you test that synthetic service?",
		},
	}
}

func enabledConfig(base string) interviewer.Config {
	return interviewer.Config{
		BaseURL:       base,
		APIKey:        "test-interviewer-key",
		WebhookSecret: "test-webhook-secret",
		Enabled:       true,
	}
}

func signBody(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func verdictForRecommendation(recommendation string) string {
	switch recommendation {
	case "strong_hire":
		return "Strong Qualify"
	case "hire":
		return "Qualify"
	case "lean_hire":
		return "Borderline"
	case "no_hire", "strong_no_hire":
		return "Not Qualified"
	default:
		return ""
	}
}

func completedBody(id, recommendation string) []byte {
	payload := map[string]any{
		"id":     id,
		"status": "completed",
		"scores": map[string]any{
			"Content":       map[string]any{"score": 4, "reasoning": "synthetic depth"},
			"Communication": map[string]any{"score": 3, "reasoning": "synthetic clarity"},
		},
		"overall":        3.5,
		"transcript_ref": "interviews/iv-synthetic-001",
		"recommendation": recommendation,
		"verdict":        verdictForRecommendation(recommendation),
		"summary":        "Synthetic screening summary.",
	}
	b, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return b
}

func scoreNamed(rep *interviewer.Report, name string) (interviewer.Score, bool) {
	if rep == nil {
		return interviewer.Score{}, false
	}
	for _, s := range rep.Scores {
		if s.Name == name {
			return s, true
		}
	}
	return interviewer.Score{}, false
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type bufLog struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *bufLog) Printf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Fprintf(&l.b, format, args...)
	l.b.WriteByte('\n')
}

func (l *bufLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

func assertAdvisory(t interface {
	Helper()
	Fatalf(string, ...any)
}, h interviewer.Handoff, stage interviewer.Stage) {
	t.Helper()
	if h.Stage != stage {
		t.Fatalf("stage %q", h.Stage)
	}
	if h.StageChanged || h.AutoRejected {
		t.Fatalf("stageChanged=%v autoRejected=%v", h.StageChanged, h.AutoRejected)
	}
	if h.Decision() != interviewer.DecisionAdvisory {
		t.Fatalf("decision %q", h.Decision())
	}
}
