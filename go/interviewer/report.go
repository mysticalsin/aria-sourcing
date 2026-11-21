package interviewer

import (
	"fmt"
	"math"
	"regexp"
	"sort"
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

type remoteScore struct {
	Score     float64 `json:"score"`
	Reasoning string  `json:"reasoning"`
}

type remoteScreening struct {
	ID             string                 `json:"id"`
	Status         string                 `json:"status"`
	Scores         map[string]remoteScore `json:"scores"`
	Competencies   map[string]remoteScore `json:"competencies"`
	Overall        *float64               `json:"overall"`
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
	for _, name := range names {
		if name == "" {
			return Report{}, fmt.Errorf("%w: score name", ErrValidation)
		}
		value, err := integerScore(src[name].Score)
		if err != nil {
			return Report{}, err
		}
		scores = append(scores, Score{Name: name, Value: value, Reasoning: Redact(src[name].Reasoning)})
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
	if r.Overall != nil {
		rep.Overall = *r.Overall
	}
	return rep, nil
}

func integerScore(n float64) (int, error) {
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 5 || n != math.Trunc(n) {
		return 0, fmt.Errorf("%w: score", ErrValidation)
	}
	return int(n), nil
}

func mapRecommendation(rec, verdict string) (string, error) {
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
