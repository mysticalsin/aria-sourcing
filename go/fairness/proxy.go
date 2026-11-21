package fairness

import (
	"sort"
	"strings"
)

func flagProxies(run Run) (flags []ProxyFlag, verdict Verdict, detail string) {
	ids := map[string]map[string]struct{}{
		"postcode":       {},
		"graduationYear": {},
		"photo":          {},
	}
	reasons := map[string]string{
		"postcode":       "postcode can proxy for a protected group",
		"graduationYear": "graduation year implies age",
		"photo":          "a photo can proxy for a protected group",
	}
	for _, c := range run.Candidates {
		for key, value := range c.Features {
			feature, ok := proxyFeature(key)
			if !ok || !proxyValuePresent(feature, value) {
				continue
			}
			ids[feature][c.ID] = struct{}{}
		}
	}
	flags = []ProxyFlag{}
	for _, feature := range []string{"postcode", "graduationYear", "photo"} {
		set := ids[feature]
		if len(set) == 0 {
			continue
		}
		list := make([]string, 0, len(set))
		for id := range set {
			list = append(list, id)
		}
		sort.Strings(list)
		flags = append(flags, ProxyFlag{Feature: feature, Reason: reasons[feature], CandidateIDs: list})
	}
	if len(flags) == 0 {
		return flags, VerdictPass, "no proxy features flagged"
	}
	return flags, VerdictWarn, "proxy features are present; a human should confirm they were not used to rank"
}

func proxyFeature(key string) (string, bool) {
	switch canonKey(key) {
	case "postcode", "postalcode", "zip", "zipcode":
		return "postcode", true
	case "graduationyear", "gradyear":
		return "graduationYear", true
	case "photopresent", "photo", "hasphoto":
		return "photo", true
	default:
		return "", false
	}
}

func proxyValuePresent(feature string, value any) bool {
	switch feature {
	case "graduationYear":
		_, ok := asNumber(value)
		return ok
	case "postcode":
		text, ok := value.(string)
		return ok && strings.TrimSpace(text) != ""
	case "photo":
		switch v := value.(type) {
		case bool:
			return v
		case string:
			return strings.TrimSpace(v) != ""
		case float64:
			return v != 0
		case int:
			return v != 0
		case int64:
			return v != 0
		default:
			return false
		}
	default:
		return false
	}
}

func asNumber(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case jsonNumber:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// jsonNumber matches encoding/json.Number without importing it in a type switch
// that would require a named conversion at every call site.
type jsonNumber interface {
	Float64() (float64, error)
}
