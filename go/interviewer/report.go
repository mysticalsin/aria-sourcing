package interviewer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

var (
	screeningIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	transcriptPattern  = regexp.MustCompile(`^interviews/[A-Za-z0-9_-]{1,64}$`)
)

var recommendationEnum = map[string]struct{}{
	"strong_hire":    {},
	"hire":           {},
	"lean_hire":      {},
	"no_hire":        {},
	"strong_no_hire": {},
}

// Verdict strings are the human labels from the interviewer scorer.
// Unknown verdicts are rejected rather than coerced into no_hire.
var verdictToRecommendation = map[string]string{
	"Strong Qualify": "strong_hire",
	"Qualify":        "hire",
	"Borderline":     "lean_hire",
	"Not Qualified":  "no_hire",
}

// numberText keeps a JSON number, or null, without turning a missing field
// into zero. Any other token is rejected while the payload is decoded, so a
// string score cannot slip through on a status that does not build a report.
type numberText struct {
	raw json.RawMessage
}

func (n *numberText) UnmarshalJSON(b []byte) error {
	trimmed := bytes.TrimSpace(b)
	if len(trimmed) == 0 {
		return fmt.Errorf("%w: number", ErrValidation)
	}
	if bytes.Equal(trimmed, []byte("null")) {
		n.raw = append(json.RawMessage(nil), trimmed...)
		return nil
	}
	var v float64
	if err := json.Unmarshal(trimmed, &v); err != nil {
		return fmt.Errorf("%w: number", ErrValidation)
	}
	n.raw = append(json.RawMessage(nil), trimmed...)
	return nil
}

type remoteScore struct {
	Score     numberText `json:"score"`
	Reasoning string     `json:"reasoning"`
}

type remoteScreening struct {
	ID             string                 `json:"id"`
	Status         string                 `json:"status"`
	Scores         map[string]remoteScore `json:"scores"`
	Competencies   map[string]remoteScore `json:"competencies"`
	Overall        numberText             `json:"overall"`
	TranscriptRef  string                 `json:"transcript_ref"`
	InterviewID    string                 `json:"interview_id"`
	Recommendation string                 `json:"recommendation"`
	Verdict        string                 `json:"verdict"`
	Summary        string                 `json:"summary"`
}

func (r remoteScreening) report() (Report, error) {
	src := r.Scores
	if len(src) == 0 {
		src = r.Competencies
	}
	if len(src) == 0 {
		return Report{}, fmt.Errorf("%w: scores", ErrValidation)
	}
	names := make([]string, 0, len(src))
	for name := range src {
		names = append(names, name)
	}
	sort.Strings(names)
	scores := make([]Score, 0, len(names))
	for _, rawName := range names {
		item := src[rawName]
		// Names are stored on the advisory report, so they get the same scrub
		// as reasoning. A competency called an email address must not stick.
		name := strings.TrimSpace(Redact(rawName))
		if name == "" {
			return Report{}, fmt.Errorf("%w: score name", ErrValidation)
		}
		value, err := integerScore(item.Score)
		if err != nil {
			return Report{}, err
		}
		scores = append(scores, Score{Name: name, Value: value, Reasoning: Redact(item.Reasoning)})
	}
	rec, err := mapRecommendation(r.Recommendation, r.Verdict)
	if err != nil {
		return Report{}, err
	}
	ref, err := transcriptReference(r.TranscriptRef, r.InterviewID)
	if err != nil {
		return Report{}, err
	}
	summary := Redact(r.Summary)
	if len(summary) > maxSummaryLen {
		return Report{}, fmt.Errorf("%w: summary", ErrValidation)
	}
	rep := Report{
		Scores:         scores,
		TranscriptRef:  ref,
		Recommendation: rec,
		Verdict:        r.Verdict,
		Summary:        summary,
		Advisory:       true,
	}
	overall, ok, err := parseOverall(r.Overall)
	if err != nil {
		return Report{}, err
	}
	if ok {
		rep.Overall = overall
	}
	return rep, nil
}

func integerScore(raw numberText) (int, error) {
	trimmed := bytes.TrimSpace(raw.raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return 0, fmt.Errorf("%w: score", ErrValidation)
	}
	var n float64
	if err := json.Unmarshal(trimmed, &n); err != nil {
		return 0, fmt.Errorf("%w: score", ErrValidation)
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 5 || n != math.Trunc(n) {
		return 0, fmt.Errorf("%w: score", ErrValidation)
	}
	return int(n), nil
}

// parseOverall accepts a missing overall. Null, non-finite, and values outside
// the competency scale are rejected. The live scorer's overall is the mean of
// 0–5 scores, so 7.2 cannot be that mean.
func parseOverall(raw numberText) (float64, bool, error) {
	trimmed := bytes.TrimSpace(raw.raw)
	if len(trimmed) == 0 {
		return 0, false, nil
	}
	if bytes.Equal(trimmed, []byte("null")) {
		return 0, false, fmt.Errorf("%w: overall", ErrValidation)
	}
	var n float64
	if err := json.Unmarshal(trimmed, &n); err != nil {
		return 0, false, fmt.Errorf("%w: overall", ErrValidation)
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 5 {
		return 0, false, fmt.Errorf("%w: overall", ErrValidation)
	}
	return n, true, nil
}

func mapRecommendation(rec, verdict string) (string, error) {
	if verdict != "" {
		mapped, ok := verdictToRecommendation[verdict]
		if !ok {
			return "", fmt.Errorf("%w: verdict", ErrValidation)
		}
		// strong_no_hire has no separate human label. Not Qualified is that
		// label for both no_hire and strong_no_hire. Every other pair must match.
		if rec != "" && mapped != rec && !(rec == "strong_no_hire" && verdict == "Not Qualified") {
			return "", fmt.Errorf("%w: verdict", ErrValidation)
		}
	}
	if rec != "" {
		if _, ok := recommendationEnum[rec]; !ok {
			return "", fmt.Errorf("%w: recommendation", ErrValidation)
		}
		return rec, nil
	}
	mapped, ok := verdictToRecommendation[verdict]
	if !ok {
		return "", fmt.Errorf("%w: verdict", ErrValidation)
	}
	return mapped, nil
}

func transcriptReference(ref, interviewID string) (string, error) {
	if ref != "" {
		if !transcriptPattern.MatchString(ref) {
			return "", fmt.Errorf("%w: transcript ref", ErrValidation)
		}
		return ref, nil
	}
	if screeningIDPattern.MatchString(interviewID) {
		return "interviews/" + interviewID, nil
	}
	return "", fmt.Errorf("%w: transcript ref", ErrValidation)
}
