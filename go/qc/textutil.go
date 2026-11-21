package qc

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

func stripInvisible(s string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case '\u200b', '\u200c', '\u200d', '\ufeff', '\u2060':
			return -1
		default:
			return r
		}
	}, s)
}

func norm(s string) string {
	s = strings.ToLower(stripInvisible(s))
	var b strings.Builder
	b.Grow(len(s))
	space := true
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			space = false
			continue
		}
		if !space {
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}

func primaryLang(tag string) string {
	tag = strings.ToLower(strings.TrimSpace(tag))
	tag = strings.ReplaceAll(tag, "_", "-")
	if tag == "" {
		return ""
	}
	if i := strings.IndexAny(tag, "- "); i >= 0 {
		tag = tag[:i]
	}
	return tag
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "..."
}

func draftText(d Draft) string {
	return stripInvisible(d.Subject + "\n" + d.Body)
}
