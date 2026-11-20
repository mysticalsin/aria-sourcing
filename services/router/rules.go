package router

import (
	"fmt"
	"strconv"
	"strings"
)

// Task is the kind of decision being routed. Rules cover the closed set of
// deterministic recruiting decisions; everything else needs a model.
type Task string

const (
	TaskSourceCheck Task = "source_check"
	TaskStageLabel  Task = "stage_label"
	TaskScoreBand   Task = "score_band"
	TaskNotice      Task = "notice"
	TaskOptOut      Task = "opt_out"
	TaskSuppression Task = "suppression"
	TaskQC          Task = "qc"
	TaskClassify    Task = "classify"
	TaskExtract     Task = "extract"
	TaskIntake      Task = "intake"
	TaskDraft       Task = "draft"
)

// Allowlisted sources. Comparison is case-insensitive and exact.
var sourceAllowlist = []string{
	"LinkedIn Recruiter CSV",
	"RSC/ATS",
	"Candidate-supplied",
	"Job application",
}

// Pipeline stages rebuilt from Smart. Hired stays a label here; the hire
// gate itself lives in the Odoo addon, not in the router.
var stageLabels = []string{
	"To Rate",
	"To Assess",
	"To Interview",
	"Shoot",
	"QM",
	"To Hire",
	"Hired",
}

var knownTasks = map[Task]bool{
	TaskSourceCheck: true,
	TaskStageLabel:  true,
	TaskScoreBand:   true,
	TaskNotice:      true,
	TaskOptOut:      true,
	TaskSuppression: true,
	TaskQC:          true,
	TaskClassify:    true,
	TaskExtract:     true,
	TaskIntake:      true,
	TaskDraft:       true,
}

var bannedPhrases = []string{
	"guarantee",
	"act now",
	"click here",
	"winner",
	"free money",
}

type ruleMatch struct {
	text string
}

// applyRules returns a template decision when the request is fully
// determined. ok is false when a model is required.
func applyRules(req Request) (ruleMatch, bool) {
	if !knownTasks[req.Task] {
		return ruleMatch{text: "rejected: unknown task"}, true
	}
	switch req.Task {
	case TaskOptOut:
		who := strings.TrimSpace(req.Input)
		if who == "" {
			who = "the recipient"
		}
		return ruleMatch{text: fmt.Sprintf(
			"Opt-out recorded for %s. No further messages. Confirmation only; nothing is sent automatically.",
			who,
		)}, true
	case TaskSuppression:
		if strings.EqualFold(strings.TrimSpace(req.Fields["suppressed"]), "true") {
			return ruleMatch{text: "Do not contact. Suppression is in force."}, true
		}
		return ruleMatch{text: "Suppression flag is not set."}, true
	case TaskNotice:
		return noticeRule(req), true
	}

	if strings.TrimSpace(req.Input) == "" && len(req.Fields) == 0 {
		return ruleMatch{text: "rejected: empty input"}, true
	}

	switch req.Task {
	case TaskSourceCheck:
		if canon, ok := canonical(sourceAllowlist, req.Input); ok {
			return ruleMatch{text: "source: " + canon}, true
		}
		return ruleMatch{text: "rejected: source not on the allowlist"}, true
	case TaskStageLabel:
		if canon, ok := canonical(stageLabels, req.Input); ok {
			return ruleMatch{text: "stage: " + canon}, true
		}
		return ruleMatch{}, false
	case TaskScoreBand:
		score, ok := parseScore(req.Input)
		if !ok {
			if raw := strings.TrimSpace(req.Fields["score"]); raw != "" {
				score, ok = parseScore(raw)
			}
		}
		if !ok {
			return ruleMatch{}, false
		}
		return ruleMatch{text: scoreText(score)}, true
	case TaskQC:
		return qcRule(req)
	case TaskDraft:
		if req.Shortlisted {
			return ruleMatch{}, false
		}
		if draftReady(req.Fields) {
			return ruleMatch{text: draftText(req.Fields)}, true
		}
		return ruleMatch{}, false
	default:
		// classify, extract, intake: no template.
		return ruleMatch{}, false
	}
}

func noticeRule(req Request) ruleMatch {
	f := req.Fields
	need := []string{"candidate_ref", "source", "purpose", "retention_days", "notice_version"}
	for _, k := range need {
		if strings.TrimSpace(f[k]) == "" {
			return ruleMatch{text: "rejected: notice incomplete"}
		}
	}
	src, ok := canonical(sourceAllowlist, f["source"])
	if !ok {
		return ruleMatch{text: "rejected: notice source not on the allowlist"}
	}
	days, err := strconv.Atoi(strings.TrimSpace(f["retention_days"]))
	if err != nil || days <= 0 {
		return ruleMatch{text: "rejected: notice retention invalid"}
	}
	return ruleMatch{text: fmt.Sprintf(
		"Notice %s: we process %s from %s for %s. Retention %d days. You may object and request erasure. Opt out: unsubscribe@example.test",
		strings.TrimSpace(f["notice_version"]),
		strings.TrimSpace(f["candidate_ref"]),
		src,
		strings.TrimSpace(f["purpose"]),
		days,
	)}
}

func qcRule(req Request) (ruleMatch, bool) {
	body := strings.TrimSpace(req.Input)
	lower := strings.ToLower(body)
	switch {
	case body == "":
		return ruleMatch{text: "qc: fail; empty body"}, true
	case containsAny(lower, bannedPhrases):
		return ruleMatch{text: "qc: fail; banned phrase"}, true
	case !strings.Contains(body, "[notice]"):
		return ruleMatch{text: "qc: fail; notice missing"}, true
	case strings.Contains(body, "{{"):
		return ruleMatch{text: "qc: fail; unresolved token"}, true
	case len(body) < 40 || len(body) > 4000:
		return ruleMatch{text: "qc: fail; length"}, true
	}
	if req.Fields["qc"] == "needs_judgment" {
		return ruleMatch{}, false
	}
	return ruleMatch{text: "qc: pass"}, true
}

func draftReady(f map[string]string) bool {
	for _, k := range []string{"candidate_ref", "role", "skill", "notice_version"} {
		if strings.TrimSpace(f[k]) == "" {
			return false
		}
	}
	return true
}

func draftText(f map[string]string) string {
	return fmt.Sprintf(
		"Hello %s, we are hiring a %s with %s. This is a suggestion a human must approve. Notice %s. Opt out: unsubscribe@example.test",
		strings.TrimSpace(f["candidate_ref"]),
		strings.TrimSpace(f["role"]),
		strings.TrimSpace(f["skill"]),
		strings.TrimSpace(f["notice_version"]),
	)
}

func scoreText(score int) string {
	band := "weak"
	switch {
	case score >= 70:
		band = "strong"
	case score >= 40:
		band = "review"
	}
	return fmt.Sprintf("score %d band %s; suggestion only, no automated decision", score, band)
}

func parseScore(raw string) (int, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 || n > 100 {
		return 0, false
	}
	return n, true
}

func canonical(list []string, raw string) (string, bool) {
	n := norm(raw)
	if n == "" {
		return "", false
	}
	for _, item := range list {
		if norm(item) == n {
			return item, true
		}
	}
	return "", false
}

func norm(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

func containsAny(haystack string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(haystack, n) {
			return true
		}
	}
	return false
}

// requiresBigModel reports complexity that must not be answered by the
// small model. Shortlisted drafts are the big-model tier in the plan
// (about 5% of decisions). The small provider is not called.
func requiresBigModel(req Request) bool {
	return req.Task == TaskDraft && req.Shortlisted
}
