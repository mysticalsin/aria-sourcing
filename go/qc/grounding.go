package qc

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	weightGrounding = 2000
	minClaimRunes   = 4
	minFactRunes    = 8
)

var tenureRe = regexp.MustCompile(`\b\d+\s+years?\b`)

func checkGrounding(in Input) checkResult {
	text := norm(in.Draft.Subject + "\n" + in.Draft.Body)
	var misses []string
	hits := 0
	total := 0
	for _, claim := range in.Draft.Claims {
		total++
		ok, why := claimGrounded(claim, text, in)
		if ok {
			hits++
			continue
		}
		misses = append(misses, why)
	}
	for _, tenure := range tenureRe.FindAllString(text, -1) {
		total++
		if tenureGrounded(tenure, in.Candidate.Facts) {
			hits++
			continue
		}
		misses = append(misses, "ungrounded tenure: "+tenure)
	}
	if total == 0 {
		return checkResult{
			id:     CheckGrounding,
			pass:   true,
			detail: "no candidate claims to ground",
			earned: weightGrounding,
			weight: weightGrounding,
		}
	}
	earned := weightGrounding * hits / total
	if hits == total {
		return checkResult{
			id:     CheckGrounding,
			pass:   true,
			detail: "ok",
			earned: weightGrounding,
			weight: weightGrounding,
		}
	}
	return checkResult{
		id:     CheckGrounding,
		pass:   false,
		detail: truncateRunes(strings.Join(misses, "; "), 500),
		earned: earned,
		weight: weightGrounding,
	}
}

func claimGrounded(claim Claim, draftNorm string, in Input) (bool, string) {
	scope := strings.ToLower(strings.TrimSpace(claim.Scope))
	if scope == "" {
		scope = ScopeCandidate
	}
	shown := truncateRunes(strings.TrimSpace(claim.Text), 80)
	if scope != ScopeCandidate && scope != ScopeNeed {
		return false, "ungrounded claim: unknown scope for " + shown
	}
	n := norm(claim.Text)
	if utf8.RuneCountInString(n) < minClaimRunes {
		return false, "ungrounded claim: too short: " + shown
	}
	if !strings.Contains(draftNorm, n) {
		return false, "ungrounded claim: not in draft: " + shown
	}
	facts := in.Candidate.Facts
	if scope == ScopeNeed {
		facts = in.Need.Facts
	}
	for _, fact := range facts {
		if !factMatchesScope(fact, scope) {
			continue
		}
		fn := norm(fact.Text)
		if fn == "" {
			fn = norm(fact.Value)
		}
		if fn == "" {
			continue
		}
		if strings.Contains(fn, n) {
			return true, ""
		}
		if utf8.RuneCountInString(fn) >= minFactRunes && strings.Contains(n, fn) {
			return true, ""
		}
	}
	return false, fmt.Sprintf("ungrounded %s claim: %s", scope, shown)
}

func factMatchesScope(f Fact, scope string) bool {
	fs := strings.ToLower(strings.TrimSpace(f.Scope))
	return fs == scope
}

func tenureGrounded(tenure string, facts []Fact) bool {
	for _, fact := range facts {
		if !factMatchesScope(fact, ScopeCandidate) {
			continue
		}
		if strings.Contains(norm(fact.Text+" "+fact.Value), tenure) {
			return true
		}
	}
	return false
}
