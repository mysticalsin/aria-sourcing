package qc

import (
	"strings"
	"unicode"
)

const (
	weightLanguage = 1500
	minLangHits    = 3
)

// Stopwords are disjoint on purpose. A shared token would make the winner
// depend on map order. Short ambiguous tokens (a, de, la) are left out.
var stopwords = map[string][]string{
	"en": {"the", "and", "you", "your", "with", "this", "that", "have", "from", "our", "are", "would", "please", "thank", "hello"},
	"fr": {"vous", "votre", "nous", "cette", "bonjour", "merci", "recrutement", "équipe", "poste", "dans"},
	"de": {"und", "nicht", "danke", "bitte", "ihnen", "ihre"},
	"es": {"usted", "gracias", "hola", "estoy", "equipo"},
	"pt": {"você", "obrigado", "olá", "conosco", "não"},
	"it": {"grazie", "ciao", "siamo", "cercando", "posizione"},
	"nl": {"alstublieft", "dank", "groeten", "wij", "onze"},
}

var languageOrder = []string{"en", "fr", "de", "es", "pt", "it", "nl"}

var wordLang = indexStopwords(stopwords)

func indexStopwords(lists map[string][]string) map[string]string {
	out := make(map[string]string)
	for _, lang := range languageOrder {
		for _, word := range lists[lang] {
			if prev, ok := out[word]; ok {
				panic("qc: stopword " + word + " is in " + prev + " and " + lang)
			}
			out[word] = lang
		}
	}
	return out
}

func checkLanguage(in Input) checkResult {
	fail := func(detail string) checkResult {
		return checkResult{
			id:     CheckLanguage,
			pass:   false,
			detail: detail,
			earned: 0,
			weight: weightLanguage,
		}
	}
	cand := primaryLang(in.Candidate.Language)
	if cand == "" {
		return fail("candidate language missing")
	}
	claimed := primaryLang(in.Draft.Language)
	if claimed != "" && claimed != cand {
		return fail("draft language does not match candidate")
	}
	detected, hits, tie := detectLanguage(draftText(in.Draft))
	if tie || hits < minLangHits || detected == "" {
		return fail("language undetermined")
	}
	if detected != cand {
		return fail("language is " + detected + ", candidate is " + cand)
	}
	if claimed != "" && claimed != detected {
		return fail("draft language does not match text")
	}
	return checkResult{
		id:     CheckLanguage,
		pass:   true,
		detail: "language " + detected,
		earned: weightLanguage,
		weight: weightLanguage,
	}
}

func detectLanguage(text string) (lang string, hits int, tie bool) {
	counts := map[string]int{}
	for _, tok := range tokens(text) {
		if lang, ok := wordLang[tok]; ok {
			counts[lang]++
		}
	}
	bestLang := ""
	best := 0
	second := 0
	for _, lang := range languageOrder {
		n := counts[lang]
		if n > best {
			second = best
			best = n
			bestLang = lang
			continue
		}
		if n > second {
			second = n
		}
	}
	if best < minLangHits {
		return "", best, false
	}
	if second == best {
		return "", best, true
	}
	return bestLang, best, false
}

func tokens(text string) []string {
	return strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}
