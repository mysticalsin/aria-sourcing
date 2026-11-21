package qc

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const weightProtected = 2000

var (
	ageRe        = regexp.MustCompile(`(?i)\b\d{1,3}[\s-]*years?[\s-]*olds?\b|\b(too old|too young|elderly|teenager|young)\b|\byour age\b|\bhow old are you\b|\bage\s*[:=]?\s*\d{1,3}\b`)
	genderRe     = regexp.MustCompile(`(?i)\b(males?|females?|transgender|non-binary|nonbinary|cisgender|women|woman|girls?|boys?|ladies|lady|gentlemen|gentleman)\b|\bmen\b|\bman\b`)
	ethnicityRe  = regexp.MustCompile(`(?i)\b(ethnicity|ethnic|caucasian|african[\s-]*american|hispanic|latinx|latino|latina|indigenous|aboriginal|biracial|multiracial)\b|\bof color\b|\byour race\b|\brace\b`)
	religionRe   = regexp.MustCompile(`(?i)\b(christian|muslim|jewish|hindu|buddhist|atheist|catholic|protestant|islam|mosque|synagogue|religion|religious)\b|\byour faith\b`)
	disabilityRe = regexp.MustCompile(`(?i)\b(disabled|disability|wheelchair|handicapped|impairment)\b`)
	familyRe     = regexp.MustCompile(`(?i)\b(pregnant|pregnancy|maternity|paternity|marital|married|unmarried|spouse|childcare)\b|\bfamily status\b|\bhave kids\b|\byour children\b`)
	prefRe       = regexp.MustCompile(`(?i)\b(prefer|preferred|preference|native|nationals only|no foreigners)\b`)
	onlyAfterRe  = regexp.MustCompile(`(?i)^[\s-]*only\b`)
)

// Demonyms are matched longest-first. "english" is omitted so a message can
// name the English language without being treated as a nationality.
var demonyms = []string{
	"south african", "new zealander",
	"american", "british", "french", "german", "indian", "chinese", "nigerian",
	"brazilian", "mexican", "canadian", "australian", "japanese", "korean",
	"spanish", "italian", "dutch", "belgian", "swiss", "swedish", "norwegian",
	"danish", "finnish", "polish", "portuguese", "russian", "ukrainian",
	"turkish", "moroccan", "algerian", "tunisian", "egyptian", "lebanese",
	"iranian", "iraqi", "pakistani", "bangladeshi", "vietnamese", "thai",
	"indonesian", "filipino", "irish", "scottish", "welsh", "greek",
	"romanian", "hungarian", "czech", "slovak", "croatian", "serbian",
	"argentine", "argentinian", "chilean", "colombian", "peruvian",
	"venezuelan", "kenyan", "ghanaian", "ethiopian", "israeli", "palestinian",
	"syrian", "afghan", "nepali", "taiwanese", "singaporean", "malaysian",
}

var demonymRe = buildDemonymRe(demonyms)

func buildDemonymRe(words []string) *regexp.Regexp {
	parts := append([]string(nil), words...)
	sort.Slice(parts, func(i, j int) bool { return len(parts[i]) > len(parts[j]) })
	for i, part := range parts {
		parts[i] = regexp.QuoteMeta(part)
	}
	return regexp.MustCompile(`(?i)\b(?:` + strings.Join(parts, "|") + `)\b`)
}

func checkProtected(in Input) checkResult {
	text := draftText(in.Draft)
	if hit, ok := firstProtected(text, allowedNationalities(in.Need)); ok {
		return checkResult{
			id:     CheckProtected,
			pass:   false,
			detail: "protected: " + hit,
			earned: 0,
			weight: weightProtected,
		}
	}
	return checkResult{
		id:     CheckProtected,
		pass:   true,
		detail: "ok",
		earned: weightProtected,
		weight: weightProtected,
	}
}

func firstProtected(text string, allowed map[string]bool) (string, bool) {
	checks := []struct {
		name string
		re   *regexp.Regexp
	}{
		{"age", ageRe},
		{"gender", genderRe},
		{"ethnicity", ethnicityRe},
		{"religion", religionRe},
		{"disability", disabilityRe},
		{"family", familyRe},
	}
	for _, check := range checks {
		if check.re.MatchString(text) {
			return check.name, true
		}
	}
	if hit, ok := nationalityHit(text, allowed); ok {
		return hit, true
	}
	return "", false
}

func nationalityHit(text string, allowed map[string]bool) (string, bool) {
	indexes := demonymRe.FindAllStringIndex(text, -1)
	for _, pair := range indexes {
		word := strings.ToLower(text[pair[0]:pair[1]])
		if allowed[word] && !preferenceAround(text, pair[0], pair[1]) {
			continue
		}
		if allowed[word] {
			return "nationality preference", true
		}
		return "nationality", true
	}
	return "", false
}

func preferenceAround(text string, start, end int) bool {
	from := rewindRunes(text, start, 40)
	if prefRe.MatchString(text[from:start]) {
		return true
	}
	to := forwardRunes(text, end, 12)
	return onlyAfterRe.MatchString(text[end:to])
}

func rewindRunes(text string, byteAt, runes int) int {
	i := byteAt
	for n := 0; n < runes && i > 0; n++ {
		_, size := utf8.DecodeLastRuneInString(text[:i])
		if size <= 0 {
			break
		}
		i -= size
	}
	return i
}

func forwardRunes(text string, byteAt, runes int) int {
	i := byteAt
	for n := 0; n < runes && i < len(text); n++ {
		_, size := utf8.DecodeRuneInString(text[i:])
		if size <= 0 {
			break
		}
		i += size
	}
	return i
}

func allowedNationalities(need Need) map[string]bool {
	out := map[string]bool{}
	for _, fact := range need.Facts {
		if !strings.EqualFold(strings.TrimSpace(fact.Attribute), AttributeLegalNationality) {
			continue
		}
		scope := strings.ToLower(strings.TrimSpace(fact.Scope))
		if scope != "" && scope != ScopeNeed {
			continue
		}
		val := strings.TrimSpace(fact.Value)
		if val == "" {
			val = strings.TrimSpace(fact.Text)
		}
		val = strings.ToLower(val)
		if val != "" {
			out[val] = true
		}
	}
	return out
}
