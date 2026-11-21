package qc

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	weightOptOut      = 1000
	weightLength      = 1500
	weightPlaceholder = 1000
	weightPromises    = 1000
)

type checkResult struct {
	id     string
	pass   bool
	detail string
	earned int
	weight int
}

var optOutRe = regexp.MustCompile(`(?i)\b(unsubscribe|opt[\s-]?out)\b`)

var placeholderRes = []*regexp.Regexp{
	regexp.MustCompile(`\{\{[^}]*\}\}`),
	regexp.MustCompile(`\$\{[^}]*\}`),
	regexp.MustCompile(`%\{[^}]*\}`),
	regexp.MustCompile(`(?i)\[[ \t]*(?:name|first[ _-]*name|last[ _-]*name|company|role|placeholder)[ \t]*\]`),
}

var promiseRes = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bguarantee[ds]?\b(?:\s+\w+){0,6}\s+\b(salary|salaries|compensation|pay|bonus|offer|package|income|wage|wages|job)\b`),
	regexp.MustCompile(`(?i)\b(salary|salaries|compensation|pay|bonus|offer|package|income|wage|wages|job)\b(?:\s+\w+){0,6}\s+\bguarantee[ds]?\b`),
	regexp.MustCompile(`(?i)\bpromise[ds]?\b(?:\s+\w+){0,6}\s+\b(salary|salaries|compensation|pay|bonus|offer|package|income|wage|wages|job)\b`),
	regexp.MustCompile(`(?i)\b(salary|compensation)\s+guarantee\b`),
}

func checkOptOut(d Draft) checkResult {
	if strings.ToLower(strings.TrimSpace(d.Channel)) != ChannelEmail {
		return checkResult{id: CheckOptOut, pass: true, detail: "not applicable", earned: weightOptOut, weight: weightOptOut}
	}
	if optOutRe.MatchString(draftText(d)) {
		return checkResult{id: CheckOptOut, pass: true, detail: "ok", earned: weightOptOut, weight: weightOptOut}
	}
	return checkResult{id: CheckOptOut, pass: false, detail: "email is missing an unsubscribe or opt-out line", earned: 0, weight: weightOptOut}
}

func checkLength(d Draft) checkResult {
	ch := strings.ToLower(strings.TrimSpace(d.Channel))
	lim, ok := channelLimits[ch]
	if !ok {
		return checkResult{id: CheckLength, pass: false, detail: "unknown channel", earned: 0, weight: weightLength}
	}
	var problems []string
	subject := utf8.RuneCountInString(d.Subject)
	body := utf8.RuneCountInString(d.Body)
	if !lim.subjectAllowed {
		if subject > 0 {
			problems = append(problems, "subject not allowed")
		}
	} else if subject > lim.subjectMax {
		problems = append(problems, fmt.Sprintf("subject %d > %d", subject, lim.subjectMax))
	}
	if body > lim.bodyMax {
		problems = append(problems, fmt.Sprintf("body %d > %d", body, lim.bodyMax))
	}
	if len(problems) > 0 {
		return checkResult{id: CheckLength, pass: false, detail: strings.Join(problems, "; "), earned: 0, weight: weightLength}
	}
	return checkResult{id: CheckLength, pass: true, detail: "ok", earned: weightLength, weight: weightLength}
}

func checkPlaceholder(d Draft) checkResult {
	text := draftText(d)
	for _, re := range placeholderRes {
		if loc := re.FindString(text); loc != "" {
			return checkResult{
				id:     CheckPlaceholder,
				pass:   false,
				detail: "placeholder: " + truncateRunes(loc, 80),
				earned: 0,
				weight: weightPlaceholder,
			}
		}
	}
	return checkResult{id: CheckPlaceholder, pass: true, detail: "ok", earned: weightPlaceholder, weight: weightPlaceholder}
}

func checkPromises(d Draft) checkResult {
	text := draftText(d)
	for _, re := range promiseRes {
		if loc := re.FindString(text); loc != "" {
			return checkResult{
				id:     CheckPromises,
				pass:   false,
				detail: "prohibited promise: " + truncateRunes(loc, 80),
				earned: 0,
				weight: weightPromises,
			}
		}
	}
	return checkResult{id: CheckPromises, pass: true, detail: "ok", earned: weightPromises, weight: weightPromises}
}
