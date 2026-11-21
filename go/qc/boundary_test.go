package qc_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

func TestLimitConstantsMatchSpec(t *testing.T) {
	spec := []struct {
		name string
		got  int
		want int
	}{
		{"inmail subject", qc.InMailSubjectMax, 200},
		{"inmail body", qc.InMailBodyMax, 1900},
		{"heyreach message", qc.HeyReachMessageMax, 8000},
		{"heyreach inmail subject", qc.HeyReachInMailSubjectMax, 200},
		{"heyreach inmail body", qc.HeyReachInMailBodyMax, 1900},
		{"heyreach connection note", qc.HeyReachConnectionNoteMax, 300},
		{"email subject", qc.EmailSubjectMax, 200},
		{"email body", qc.EmailBodyMax, 10000},
	}
	for _, item := range spec {
		if item.got != item.want {
			t.Errorf("%s = %d, spec %d", item.name, item.got, item.want)
		}
	}
}

func TestLengthBoundaries(t *testing.T) {
	cases := []struct {
		name           string
		channel        string
		subject        int
		body           int
		specSubject    int
		specBody       int
		subjectAllowed bool
	}{
		{"email", qc.ChannelEmail, qc.EmailSubjectMax, qc.EmailBodyMax, 200, 10000, true},
		{"inmail", qc.ChannelInMail, qc.InMailSubjectMax, qc.InMailBodyMax, 200, 1900, true},
		{"heyreach", qc.ChannelHeyReach, qc.HeyReachInMailSubjectMax, qc.HeyReachMessageMax, 200, 8000, true},
		{"heyreach-inmail", qc.ChannelHeyReachInMail, qc.HeyReachInMailSubjectMax, qc.HeyReachInMailBodyMax, 200, 1900, true},
		{"heyreach-connect", qc.ChannelHeyReachConnect, 0, qc.HeyReachConnectionNoteMax, 0, 300, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.subject != tc.specSubject || tc.body != tc.specBody {
				t.Fatalf("spec %s subject %d body %d, constants are %d and %d", tc.name, tc.specSubject, tc.specBody, tc.subject, tc.body)
			}
			body := baselineBodyNoOpt
			if tc.channel == qc.ChannelEmail {
				body = baselineBody
			}
			if tc.channel == qc.ChannelHeyReachConnect {
				body = "Hello Ada Example, your analytical engine compiler work stood out and the compiler engineer role is open. Thank you."
			}
			in := baseline()
			in.Draft.Channel = tc.channel
			in.Draft.Body = padRunes(t, body, tc.body)
			if tc.subjectAllowed {
				in.Draft.Subject = strings.Repeat("a", tc.subject)
			} else {
				in.Draft.Subject = ""
			}
			mustPass(t, in, 0.9)

			overBody := in
			overBody.Draft.Body = padRunes(t, body, tc.body+1)
			v := mustFail(t, overBody, 0.9, []string{qc.CheckLength}, 8500)
			want := "body " + itoa(tc.body+1) + " > " + itoa(tc.body)
			if !strings.Contains(reasonDetail(t, v, qc.CheckLength), want) {
				t.Fatalf("detail %q, want %q", reasonDetail(t, v, qc.CheckLength), want)
			}

			if tc.subjectAllowed {
				overSubject := in
				overSubject.Draft.Subject = strings.Repeat("a", tc.subject+1)
				v = mustFail(t, overSubject, 0.9, []string{qc.CheckLength}, 8500)
				want = "subject " + itoa(tc.subject+1) + " > " + itoa(tc.subject)
				if reasonDetail(t, v, qc.CheckLength) != want {
					t.Fatalf("detail %q, want %q", reasonDetail(t, v, qc.CheckLength), want)
				}
			} else {
				withSubject := in
				withSubject.Draft.Subject = "Hi"
				v = mustFail(t, withSubject, 0.9, []string{qc.CheckLength}, 8500)
				if reasonDetail(t, v, qc.CheckLength) != "subject not allowed" {
					t.Fatal(reasonDetail(t, v, qc.CheckLength))
				}
			}
		})
	}
}

func TestInMailSubjectAndBodyBothOver(t *testing.T) {
	if qc.InMailSubjectMax != 200 || qc.InMailBodyMax != 1900 {
		t.Fatalf("spec inmail caps are 200 and 1900, got %d and %d", qc.InMailSubjectMax, qc.InMailBodyMax)
	}
	in := baseline()
	in.Draft.Channel = qc.ChannelInMail
	in.Draft.Body = padRunes(t, baselineBodyNoOpt, qc.InMailBodyMax+1)
	in.Draft.Subject = strings.Repeat("a", qc.InMailSubjectMax+1)
	v := mustFail(t, in, 0.9, []string{qc.CheckLength}, 8500)
	want := "subject 201 > 200; body 1901 > 1900"
	if reasonDetail(t, v, qc.CheckLength) != want {
		t.Fatalf("detail %q", reasonDetail(t, v, qc.CheckLength))
	}
}

func TestLengthCountsRunesNotBytes(t *testing.T) {
	if qc.InMailSubjectMax != 200 {
		t.Fatalf("InMail subject cap is 200, got %d", qc.InMailSubjectMax)
	}
	in := baseline()
	in.Draft.Channel = qc.ChannelInMail
	in.Draft.Body = baselineBodyNoOpt
	in.Draft.Subject = strings.Repeat("a", qc.InMailSubjectMax-1) + "é"
	if utf8.RuneCountInString(in.Draft.Subject) != qc.InMailSubjectMax {
		t.Fatalf("runes %d", utf8.RuneCountInString(in.Draft.Subject))
	}
	if len(in.Draft.Subject) <= qc.InMailSubjectMax {
		t.Fatal("fixture did not use a multibyte character")
	}
	mustPass(t, in, 0.9)

	in.Draft.Subject = strings.Repeat("a", qc.InMailSubjectMax-1) + "éé"
	mustFail(t, in, 0.9, []string{qc.CheckLength}, 8500)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits [16]byte
	i := len(digits)
	for n > 0 {
		i--
		digits[i] = byte('0' + n%10)
		n /= 10
	}
	return string(digits[i:])
}
