package qc_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

func FuzzEvaluate(f *testing.F) {
	f.Add("email", "Compiler role", baselineBody, "en", "analytical engine compiler", "candidate")
	f.Add("inmail", "", "", "", "", "")
	f.Add("heyreach", "{{name}}", "We guarantee the salary", "fr", "12 years", "need")
	f.Add("heyreach-connect", "Hi", "young woman", "ja", "x", "person")
	f.Add(string([]byte{0xff, 0xfe}), "sub", "body", "en-US", "claim", "candidate")
	f.Fuzz(func(t *testing.T, channel, subject, body, lang, claim, scope string) {
		in := qc.Input{
			Draft: qc.Draft{
				Channel:  channel,
				Subject:  subject,
				Body:     body,
				Language: lang,
				Claims:   []qc.Claim{{Text: claim, Scope: scope}},
			},
			Candidate: qc.Candidate{
				Language: lang,
				Facts:    []qc.Fact{{Scope: "candidate", Text: claim, Value: body}},
			},
			Need: qc.Need{Facts: []qc.Fact{{Scope: "need", Text: subject, Attribute: "legal_nationality", Value: claim}}},
		}
		assertStable(t, in, 0.9)
	})
}

func FuzzThreshold(f *testing.F) {
	f.Add("")
	f.Add("0.9")
	f.Add("1")
	f.Add("0")
	f.Add("0.5")
	f.Add("nope")
	f.Add("1.1")
	f.Add("-0.1")
	f.Add("1e-1")
	f.Fuzz(func(t *testing.T, raw string) {
		got, err := qc.ThresholdFrom(func(key string) string {
			if key == qc.EnvQCPassThreshold {
				return raw
			}
			return ""
		})
		switch strings.TrimSpace(raw) {
		case "":
			if err != nil || got != 0.9 {
				t.Fatalf("default got %v err %v", got, err)
			}
			return
		case "0.9", "1", "0", "0.5":
			want, conv := strconv.ParseFloat(strings.TrimSpace(raw), 64)
			if conv != nil || err != nil || got != want {
				t.Fatalf("raw %q got %v err %v", raw, got, err)
			}
			return
		case "nope", "1.1", "-0.1", "1e-1":
			if err == nil {
				t.Fatalf("accepted %q", raw)
			}
		}
		if err != nil {
			if got != 0 {
				t.Fatalf("error returned %v", got)
			}
			return
		}
		if got < 0 || got > 1 {
			t.Fatalf("threshold %v", got)
		}
	})
}
