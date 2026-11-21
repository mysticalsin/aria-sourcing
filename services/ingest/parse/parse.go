// Package parse maps CV text onto structured fields with deterministic
// rules. There is no model call. The rules cover the ingest text contract:
// labeled lines (Name:, Skills:, ...) and heading blocks (SKILLS, EXPERIENCE).
package parse

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// CV is the structured record written toward Odoo. It is personal data.
// Callers must not log it.
type CV struct {
	Name       string
	Contact    Contact
	Skills     []string
	Experience []Role
	Languages  []string
	Location   string
}

// Contact holds the channels a recruiter can actually use.
type Contact struct {
	Email string
	Phone string
}

// Role is one experience line.
type Role struct {
	Title   string
	Company string
	Start   string
	End     string
}

// Rules is the default parser.
type Rules struct{}

// Parse implements the worker parser port.
func (Rules) Parse(text string) (CV, bool) { return Parse(text) }

var (
	labelRe = regexp.MustCompile(`(?i)^(name|full name|email|e-mail|phone|tel|telephone|mobile|location|city|address|languages?|skills?|experience)\s*:\s*(.*)$`)
	emailRe = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`)
	phoneRe = regexp.MustCompile(`\+?\d[\d\s().-]{6,}\d`)
	yearRe  = regexp.MustCompile(`^\d{4}\s*[-–—]\s*\d{4}$`)
	pipeRe  = regexp.MustCompile(`(?i)^(\d{4})\s*[-–—/]\s*(\d{4}|present|current)\s*\|\s*([^|]+?)\s*\|\s*(.+)$`)
	atRe    = regexp.MustCompile(`(?i)^(\d{4})\s*[-–—/]\s*(\d{4}|present|current)\s+(.+?)\s+at\s+(.+)$`)
	parenRe = regexp.MustCompile(`(?i)^(.+?)\s+at\s+(.+?)\s+\((\d{4})\s*[-–—/]\s*(\d{4}|present|current)\)$`)
)

// countries is only a hint for an unlabeled "City, Country" line. It is not
// used to infer nationality or any other trait, and a labeled Location line
// does not consult it.
var countries = map[string]struct{}{
	"france": {}, "portugal": {}, "belgium": {}, "brazil": {}, "brasil": {},
	"spain": {}, "germany": {}, "italy": {}, "canada": {}, "poland": {},
	"romania": {}, "switzerland": {}, "luxembourg": {}, "netherlands": {},
	"united kingdom": {}, "uk": {}, "usa": {}, "united states": {},
	"mexico": {}, "ireland": {}, "sweden": {}, "norway": {}, "denmark": {},
	"austria": {}, "czech republic": {}, "hungary": {}, "greece": {},
	"morocco": {}, "tunisia": {}, "senegal": {}, "india": {}, "singapore": {},
	"japan": {}, "australia": {}, "colombia": {}, "chile": {}, "argentina": {},
}

// Parse extracts fields. ok is false when the text has no name, email, or
// phone — there is nothing to hand to a recruiter.
func Parse(text string) (CV, bool) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\f", "\n")
	var cv CV
	section := "header"
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || dashesOnly(line) {
			continue
		}
		if key, val, ok := label(line); ok {
			applyLabel(&cv, key, val, &section)
			continue
		}
		if h, ok := heading(line); ok {
			section = h
			continue
		}
		switch section {
		case "skills":
			cv.Skills = append(cv.Skills, splitList(line)...)
		case "languages":
			cv.Languages = append(cv.Languages, splitList(line)...)
		case "experience":
			cleaned := strings.TrimLeft(line, "-•*\t ")
			if role, ok := parseRole(cleaned); ok {
				cv.Experience = append(cv.Experience, role)
			}
		case "location":
			if cv.Location == "" {
				cv.Location = Collapse(line)
			}
		case "skip":
			continue
		default:
			absorbHeader(&cv, line)
		}
	}
	cv.Name = Collapse(cv.Name)
	cv.Location = Collapse(cv.Location)
	cv.Contact.Email = strings.ToLower(strings.TrimSpace(cv.Contact.Email))
	cv.Skills = dedupe(cv.Skills)
	cv.Languages = dedupe(cv.Languages)
	if cv.Name == "" && cv.Contact.Email == "" && cv.Contact.Phone == "" {
		return CV{}, false
	}
	return cv, true
}

func applyLabel(cv *CV, key, val string, section *string) {
	val = strings.TrimSpace(val)
	switch key {
	case "name", "full name":
		cv.Name = val
	case "email", "e-mail":
		if e := findEmail(val); e != "" {
			cv.Contact.Email = e
		} else {
			cv.Contact.Email = val
		}
	case "phone", "tel", "telephone", "mobile":
		if p := findPhone(val); p != "" {
			cv.Contact.Phone = p
		} else {
			cv.Contact.Phone = Collapse(val)
		}
	case "location", "city", "address":
		cv.Location = val
	case "skills", "skill":
		if val != "" {
			cv.Skills = append(cv.Skills, splitList(val)...)
		}
		*section = "skills"
	case "languages", "language":
		if val != "" {
			cv.Languages = append(cv.Languages, splitList(val)...)
		}
		*section = "languages"
	case "experience":
		if val != "" {
			if role, ok := parseRole(val); ok {
				cv.Experience = append(cv.Experience, role)
			}
		}
		*section = "experience"
	}
}

func absorbHeader(cv *CV, line string) {
	if cv.Contact.Email == "" {
		if e := findEmail(line); e != "" && !strings.Contains(strings.ToLower(line), "skill") {
			cv.Contact.Email = e
			if strings.TrimSpace(line) == e || strings.EqualFold(strings.TrimSpace(line), e) {
				return
			}
		}
	}
	if cv.Contact.Phone == "" {
		if p := findPhone(line); p != "" {
			cv.Contact.Phone = p
			return
		}
	}
	if cv.Location == "" && looksLikeLocation(line) {
		cv.Location = Collapse(line)
		return
	}
	if cv.Name == "" && looksLikeName(line) {
		cv.Name = line
	}
}

func label(line string) (string, string, bool) {
	m := labelRe.FindStringSubmatch(line)
	if m == nil {
		return "", "", false
	}
	return strings.ToLower(m[1]), m[2], true
}

func heading(line string) (string, bool) {
	l := strings.ToLower(strings.TrimSpace(line))
	l = strings.TrimRight(l, ":")
	l = strings.TrimSpace(l)
	switch l {
	case "skills", "skill", "competencies", "competences":
		return "skills", true
	case "languages", "language", "langues":
		return "languages", true
	case "experience", "work experience", "professional experience":
		return "experience", true
	case "contact", "contacts":
		return "contact", true
	case "location", "address":
		return "location", true
	case "education", "formation":
		return "skip", true
	default:
		return "", false
	}
}

func looksLikeName(line string) bool {
	if strings.ContainsAny(line, "@,:/|") {
		return false
	}
	for _, r := range line {
		if unicode.IsDigit(r) {
			return false
		}
	}
	fields := strings.Fields(line)
	if len(fields) < 2 || len(fields) > 4 {
		return false
	}
	for _, f := range fields {
		r, _ := utf8.DecodeRuneInString(f)
		if !unicode.IsUpper(r) {
			return false
		}
		for _, c := range f {
			if !unicode.IsLetter(c) && c != '-' && c != '\'' {
				return false
			}
		}
	}
	return true
}

func looksLikeLocation(line string) bool {
	parts := strings.Split(line, ",")
	if len(parts) != 2 {
		return false
	}
	city := strings.TrimSpace(parts[0])
	country := strings.ToLower(strings.TrimSpace(parts[1]))
	if letterCount(city) < 2 {
		return false
	}
	_, ok := countries[country]
	return ok
}

func findEmail(s string) string {
	m := emailRe.FindString(s)
	return strings.ToLower(m)
}

func findPhone(s string) string {
	for _, m := range phoneRe.FindAllString(s, -1) {
		t := strings.TrimSpace(m)
		if yearRe.MatchString(t) {
			continue
		}
		d := digitsOnly(t)
		if len(d) < 8 || len(d) > 15 {
			continue
		}
		if !strings.ContainsAny(t, "+-.() ") && len(d) < 10 {
			continue
		}
		return Collapse(t)
	}
	return ""
}

func parseRole(line string) (Role, bool) {
	line = strings.TrimSpace(line)
	if m := pipeRe.FindStringSubmatch(line); m != nil {
		return Role{
			Start:   m[1],
			End:     canonEnd(m[2]),
			Title:   Collapse(m[3]),
			Company: Collapse(m[4]),
		}, true
	}
	if m := atRe.FindStringSubmatch(line); m != nil {
		return Role{
			Start:   m[1],
			End:     canonEnd(m[2]),
			Title:   Collapse(m[3]),
			Company: Collapse(m[4]),
		}, true
	}
	if m := parenRe.FindStringSubmatch(line); m != nil {
		return Role{
			Title:   Collapse(m[1]),
			Company: Collapse(m[2]),
			Start:   m[3],
			End:     canonEnd(m[4]),
		}, true
	}
	return Role{}, false
}

func canonEnd(s string) string {
	l := strings.ToLower(strings.TrimSpace(s))
	if l == "present" || l == "current" {
		return "present"
	}
	return l
}

func splitList(s string) []string {
	s = strings.ReplaceAll(s, " and ", ",")
	s = strings.ReplaceAll(s, " AND ", ",")
	parts := strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == ';' || r == '|' || r == '\n'
	})
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, ".")
		p = strings.TrimLeft(p, "-•*\t ")
		p = Collapse(p)
		if p == "" || strings.EqualFold(p, "and") || dashesOnly(p) {
			continue
		}
		out = append(out, p)
	}
	return out
}

func dedupe(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(items))
	var out []string
	for _, item := range items {
		key := strings.ToLower(Collapse(item))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, Collapse(item))
	}
	return out
}

func dashesOnly(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != '-' && r != '—' && r != '–' && r != '_' {
			return false
		}
	}
	return true
}

func letterCount(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			n++
		}
	}
	return n
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Collapse trims and squeezes internal whitespace to single spaces.
func Collapse(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// NormPhone keeps a leading plus and the digits. Tests compare this form.
func NormPhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == '+' && b.Len() == 0 {
			b.WriteRune(r)
			continue
		}
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
