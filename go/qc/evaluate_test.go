package qc_test

import (
	"encoding/json"
	"math"
	"strings"
	"sync"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

func TestQCVersion(t *testing.T) {
	if qc.QCVersion != "qc.v1" {
		t.Fatalf("qc_version %q", qc.QCVersion)
	}
}

func TestResultImplementsVerdict(t *testing.T) {
	res, err := qc.Evaluate(baseline(), 0.9)
	if err != nil {
		t.Fatal(err)
	}
	var v qc.Verdict = res
	if v.Status() != qc.StatusPass && v.Status() != qc.StatusFail {
		t.Fatalf("status %q", v.Status())
	}
	if v.QCVersion() != qc.QCVersion {
		t.Fatalf("method %s constant %s", v.QCVersion(), qc.QCVersion)
	}
}

func TestPassingEmail(t *testing.T) {
	v := mustPass(t, baseline(), 0.9)
	if reasonDetail(t, v, qc.CheckLanguage) != "language en" {
		t.Fatalf("language detail %q", reasonDetail(t, v, qc.CheckLanguage))
	}
	if reasonDetail(t, v, qc.CheckOptOut) != "ok" {
		t.Fatalf("opt-out detail %q", reasonDetail(t, v, qc.CheckOptOut))
	}
	if reasonDetail(t, v, qc.CheckGrounding) != "ok" {
		t.Fatalf("grounding detail %q", reasonDetail(t, v, qc.CheckGrounding))
	}
}

func TestPassingEmailAtThresholdEdges(t *testing.T) {
	in := baseline()
	for _, threshold := range []float64{0, 0.9, 1} {
		mustPass(t, in, threshold)
	}
}

func TestChannelCaseAndNonEmailOptOut(t *testing.T) {
	cases := []struct {
		channel string
		body    string
	}{
		{qc.ChannelInMail, baselineBodyNoOpt},
		{" InMail ", baselineBodyNoOpt},
		{qc.ChannelHeyReach, baselineBodyNoOpt},
		{qc.ChannelHeyReachInMail, baselineBodyNoOpt},
	}
	for _, tc := range cases {
		t.Run(tc.channel, func(t *testing.T) {
			in := baseline()
			in.Draft.Channel = tc.channel
			in.Draft.Body = tc.body
			v := mustPass(t, in, 0.9)
			if reasonDetail(t, v, qc.CheckOptOut) != "not applicable" {
				t.Fatalf("opt-out %q", reasonDetail(t, v, qc.CheckOptOut))
			}
		})
	}
}

func TestPassingHeyReachConnect(t *testing.T) {
	in := baseline()
	in.Draft.Channel = qc.ChannelHeyReachConnect
	in.Draft.Subject = ""
	in.Draft.Body = "Hello Ada Example, your analytical engine compiler work stood out and the compiler engineer role is open. Thank you."
	mustPass(t, in, 0.9)
}

func TestClaimScopeDefaultsToCandidate(t *testing.T) {
	in := withClaims(baseline(),
		qc.Claim{Text: "analytical engine compiler"},
		qc.Claim{Text: "compiler engineer role", Scope: qc.ScopeNeed},
	)
	mustPass(t, in, 0.9)
}

func TestUngroundedCandidateClaim(t *testing.T) {
	in := withBody(baseline(), baselineBody+"\n\nYou led a team of forty.")
	in = withClaims(in, qc.Claim{Text: "led a team of forty", Scope: qc.ScopeCandidate})
	v := mustFail(t, in, 0.9, []string{qc.CheckGrounding}, 8000)
	if !strings.Contains(reasonDetail(t, v, qc.CheckGrounding), "ungrounded") {
		t.Fatal(reasonDetail(t, v, qc.CheckGrounding))
	}
}

func TestNeedFactDoesNotGroundCandidateClaim(t *testing.T) {
	in := withClaims(baseline(), qc.Claim{Text: "compiler engineer role", Scope: qc.ScopeCandidate})
	mustFail(t, in, 0.9, []string{qc.CheckGrounding}, 8000)
}

func TestCandidateFactDoesNotGroundNeedClaim(t *testing.T) {
	in := withClaims(baseline(), qc.Claim{Text: "analytical engine compiler", Scope: qc.ScopeNeed})
	mustFail(t, in, 0.9, []string{qc.CheckGrounding}, 8000)
}

func TestUnscopedFactDoesNotGround(t *testing.T) {
	in := baseline()
	in.Candidate.Facts[0].Scope = ""
	mustFail(t, in, 0.9, []string{qc.CheckGrounding}, 9000)
}

func TestClaimMissingFromDraft(t *testing.T) {
	in := withClaims(baseline(), qc.Claim{Text: "orbital relay design", Scope: qc.ScopeCandidate})
	in.Candidate.Facts = append(in.Candidate.Facts, qc.Fact{
		Scope: qc.ScopeCandidate,
		Text:  "Ada Example designed the orbital relay design",
	})
	v := mustFail(t, in, 0.9, []string{qc.CheckGrounding}, 8000)
	if !strings.Contains(reasonDetail(t, v, qc.CheckGrounding), "not in draft") {
		t.Fatal(reasonDetail(t, v, qc.CheckGrounding))
	}
}

func TestGroundingPartialUsesIntegerWeights(t *testing.T) {
	body := baselineBody + "\n\nYou led a team of forty and invented the steam press."
	in := withBody(baseline(), body)
	in = withClaims(in,
		qc.Claim{Text: "analytical engine compiler", Scope: qc.ScopeCandidate},
		qc.Claim{Text: "led a team of forty", Scope: qc.ScopeCandidate},
		qc.Claim{Text: "invented the steam press", Scope: qc.ScopeCandidate},
	)
	v := mustFail(t, in, 0.9, []string{qc.CheckGrounding}, 8666)
	if v.Status() != qc.StatusFail {
		t.Fatal(v.Status())
	}
}

func TestTenureMustComeFromCandidateFacts(t *testing.T) {
	in := withBody(baseline(), baselineBody+"\n\nYou have 12 years of Go.")
	in.Need.Facts = append(in.Need.Facts, qc.Fact{
		Scope: qc.ScopeNeed,
		Text:  "12 years of Go required",
	})
	v := mustFail(t, in, 0.9, []string{qc.CheckGrounding}, 9333)
	if !strings.Contains(reasonDetail(t, v, qc.CheckGrounding), "12 years") {
		t.Fatal(reasonDetail(t, v, qc.CheckGrounding))
	}

	grounded := withBody(baseline(), baselineBody+"\n\nYou have 12 years of Go.")
	grounded.Candidate.Facts = append(grounded.Candidate.Facts, qc.Fact{
		Scope: qc.ScopeCandidate,
		Text:  "Ada Example has 12 years of Go",
	})
	mustPass(t, grounded, 0.9)
}

func TestProtectedCategories(t *testing.T) {
	cases := []struct {
		name string
		add  string
		want string
	}{
		{"age", " You are too old for this role.", "protected: age"},
		{"young", " We want a young engineer.", "protected: age"},
		{"gender", " We want a woman for this work.", "protected: gender"},
		{"ethnicity", " Your ethnicity is not a factor we should name.", "protected: ethnicity"},
		{"religion", " Your religion is not relevant.", "protected: religion"},
		{"disability", " A wheelchair is not part of this note.", "protected: disability"},
		{"family", " If you are married, ignore that.", "protected: family"},
		{"nationality", " This note assumes you are German.", "protected: nationality"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := withBody(baseline(), baselineBody+tc.add)
			v := mustFail(t, in, 0.9, []string{qc.CheckProtected}, 8000)
			if reasonDetail(t, v, qc.CheckProtected) != tc.want {
				t.Fatalf("detail %q", reasonDetail(t, v, qc.CheckProtected))
			}
		})
	}
}

func TestProtectedFactDoesNotAuthorizeTheAttribute(t *testing.T) {
	in := withBody(baseline(), baselineBody+" You are 34 years old.")
	in.Candidate.Facts = append(in.Candidate.Facts, qc.Fact{
		Scope: qc.ScopeCandidate,
		Text:  "Ada Example is 34 years old",
	})
	mustFail(t, in, 0.9, []string{qc.CheckProtected}, 8000)
}

func TestSeniorEngineerIsNotAge(t *testing.T) {
	in := withBody(baseline(), baselineBody+" This is for a senior engineer.")
	mustPass(t, in, 0.9)
}

func TestAgeReportedBeforeNationality(t *testing.T) {
	in := withBody(baseline(), baselineBody+" You are a young German engineer.")
	v := mustFail(t, in, 0.9, []string{qc.CheckProtected}, 8000)
	if reasonDetail(t, v, qc.CheckProtected) != "protected: age" {
		t.Fatal(reasonDetail(t, v, qc.CheckProtected))
	}
}

func TestLegalNationality(t *testing.T) {
	legal := qc.Fact{Scope: qc.ScopeNeed, Attribute: qc.AttributeLegalNationality, Value: "French"}
	ok := withBody(baseline(), baselineBody+" This role requires French work authorization.")
	ok.Need.Facts = append(ok.Need.Facts, legal)
	mustPass(t, ok, 0.9)

	prefer := withBody(baseline(), baselineBody+" We prefer French engineers.")
	prefer.Need.Facts = append(prefer.Need.Facts, legal)
	v := mustFail(t, prefer, 0.9, []string{qc.CheckProtected}, 8000)
	if reasonDetail(t, v, qc.CheckProtected) != "protected: nationality preference" {
		t.Fatal(reasonDetail(t, v, qc.CheckProtected))
	}

	only := withBody(baseline(), baselineBody+" French only work authorization is listed.")
	only.Need.Facts = append(only.Need.Facts, legal)
	mustFail(t, only, 0.9, []string{qc.CheckProtected}, 8000)

	other := withBody(baseline(), baselineBody+" This role requires French and German work authorization.")
	other.Need.Facts = append(other.Need.Facts, legal)
	v = mustFail(t, other, 0.9, []string{qc.CheckProtected}, 8000)
	if reasonDetail(t, v, qc.CheckProtected) != "protected: nationality" {
		t.Fatal(reasonDetail(t, v, qc.CheckProtected))
	}

	missing := withBody(baseline(), baselineBody+" This role requires French work authorization.")
	mustFail(t, missing, 0.9, []string{qc.CheckProtected}, 8000)

	onCandidate := withBody(baseline(), baselineBody+" This role requires French work authorization.")
	onCandidate.Candidate.Facts = append(onCandidate.Candidate.Facts, qc.Fact{
		Scope: qc.ScopeCandidate, Attribute: qc.AttributeLegalNationality, Value: "French",
	})
	mustFail(t, onCandidate, 0.9, []string{qc.CheckProtected}, 8000)

	mistagged := withBody(baseline(), baselineBody+" This role requires French work authorization.")
	mistagged.Need.Facts = append(mistagged.Need.Facts, qc.Fact{
		Scope: qc.ScopeCandidate, Attribute: qc.AttributeLegalNationality, Value: "French",
	})
	mustFail(t, mistagged, 0.9, []string{qc.CheckProtected}, 8000)

	emptyScope := withBody(baseline(), baselineBody+" This role requires French work authorization.")
	emptyScope.Need.Facts = append(emptyScope.Need.Facts, qc.Fact{
		Attribute: qc.AttributeLegalNationality, Value: " French ",
	})
	mustPass(t, emptyScope, 0.9)
}

func TestZeroWidthDoesNotBypass(t *testing.T) {
	hidden := withBody(baseline(), strings.Replace(baselineBody, "unsubscribe", "unsub\u200bscribe", 1))
	mustPass(t, hidden, 0.9)

	gender := withBody(baseline(), baselineBody+" The wo\u200bman who wrote this compiler is who we mean.")
	v := mustFail(t, gender, 0.9, []string{qc.CheckProtected}, 8000)
	if reasonDetail(t, v, qc.CheckProtected) != "protected: gender" {
		t.Fatal(reasonDetail(t, v, qc.CheckProtected))
	}
}

func TestOptOut(t *testing.T) {
	missing := withBody(baseline(), baselineBodyNoOpt)
	v := mustFail(t, missing, 0.9, []string{qc.CheckOptOut}, 9000)
	if !strings.Contains(reasonDetail(t, v, qc.CheckOptOut), "unsubscribe") {
		t.Fatal(reasonDetail(t, v, qc.CheckOptOut))
	}

	optOut := strings.Replace(baselineBody, "You can unsubscribe at https://example.com/unsubscribe.", "You can opt out of these notes.", 1)
	mustPass(t, withBody(baseline(), optOut), 0.9)

	// A score that still meets 0.9 must not waive the missing line.
	mustFail(t, missing, 0, []string{qc.CheckOptOut}, 9000)
}

func TestPlaceholders(t *testing.T) {
	leaks := []string{" {{name}}", " {{ name }}", " {{first_name}}", " [Name]", " ${name}", " %{name}"}
	for _, leak := range leaks {
		t.Run(leak, func(t *testing.T) {
			in := withBody(baseline(), baselineBody+leak)
			v := mustFail(t, in, 0.9, []string{qc.CheckPlaceholder}, 9000)
			if !strings.Contains(reasonDetail(t, v, qc.CheckPlaceholder), "placeholder:") {
				t.Fatal(reasonDetail(t, v, qc.CheckPlaceholder))
			}
		})
	}
}

func TestPromises(t *testing.T) {
	bad := []string{
		" We guarantee the salary.",
		" The salary is guaranteed.",
		" We promise a job.",
		" There is a salary guarantee in this note.",
	}
	for _, sentence := range bad {
		t.Run(sentence, func(t *testing.T) {
			v := mustFail(t, withBody(baseline(), baselineBody+sentence), 0.9, []string{qc.CheckPromises}, 9000)
			if !strings.Contains(reasonDetail(t, v, qc.CheckPromises), "prohibited promise") {
				t.Fatal(reasonDetail(t, v, qc.CheckPromises))
			}
		})
	}
	good := []string{
		" We promise a conversation.",
		" You will get a guaranteed reply from a person.",
		" The need lists a salary band.",
	}
	for _, sentence := range good {
		t.Run(sentence, func(t *testing.T) {
			mustPass(t, withBody(baseline(), baselineBody+sentence), 0.9)
		})
	}
}

func TestLowThresholdDoesNotWaiveProtected(t *testing.T) {
	in := withBody(baseline(), baselineBody+" We want a woman for this work.")
	mustFail(t, in, 0, []string{qc.CheckProtected}, 8000)
}

func TestLanguageMismatch(t *testing.T) {
	in := baseline()
	in.Draft.Body = "Bonjour Ada Example. Votre travail sur analytical engine compiler est connu. Cette équipe recrute pour le poste compiler engineer role. Merci. Nous répondons. Vous pouvez unsubscribe at https://example.com/unsubscribe."
	in.Candidate.Language = "en"
	v := mustFail(t, in, 0.9, []string{qc.CheckLanguage}, 8500)
	if !strings.Contains(reasonDetail(t, v, qc.CheckLanguage), "fr") {
		t.Fatal(reasonDetail(t, v, qc.CheckLanguage))
	}
}

func TestLanguageSamples(t *testing.T) {
	samples := []struct {
		lang string
		body string
	}{
		{"en", "Hello, thank you, and your team are with this note."},
		{"en-US", "Hello, thank you, and your team are with this note."},
		{"EN", "Hello, thank you, and your team are with this note."},
		{"en_US", "Hello, thank you, and your team are with this note."},
		{"fr", "Bonjour, merci, votre équipe et ce poste nous intéressent dans le recrutement."},
		{"de", "Danke und bitte, Ihre Nachricht ist nicht vergessen."},
		{"es", "Hola, gracias, usted estoy con el equipo."},
		{"pt-BR", "Olá, você, obrigado, não, conosco."},
		{"it", "Ciao, grazie, siamo cercando una posizione."},
		{"nl", "Dank en groeten, wij en onze vrienden, alstublieft."},
	}
	for _, sample := range samples {
		t.Run(sample.lang, func(t *testing.T) {
			in := qc.Input{
				Draft:     qc.Draft{Channel: qc.ChannelInMail, Body: sample.body},
				Candidate: qc.Candidate{Language: sample.lang},
			}
			v := mustPass(t, in, 0.9)
			if !strings.HasPrefix(reasonDetail(t, v, qc.CheckLanguage), "language ") {
				t.Fatal(reasonDetail(t, v, qc.CheckLanguage))
			}
		})
	}
}

func TestLanguageFailClosed(t *testing.T) {
	short := qc.Input{
		Draft:     qc.Draft{Channel: qc.ChannelInMail, Body: "Hi Ada."},
		Candidate: qc.Candidate{Language: "en"},
	}
	v := mustFail(t, short, 0.9, []string{qc.CheckLanguage}, 8500)
	if reasonDetail(t, v, qc.CheckLanguage) != "language undetermined" {
		t.Fatal(reasonDetail(t, v, qc.CheckLanguage))
	}

	missing := baseline()
	missing.Candidate.Language = ""
	v = mustFail(t, missing, 0.9, []string{qc.CheckLanguage}, 8500)
	if reasonDetail(t, v, qc.CheckLanguage) != "candidate language missing" {
		t.Fatal(reasonDetail(t, v, qc.CheckLanguage))
	}

	labeled := baseline()
	labeled.Draft.Language = "fr"
	v = mustFail(t, labeled, 0.9, []string{qc.CheckLanguage}, 8500)
	if !strings.Contains(reasonDetail(t, v, qc.CheckLanguage), "does not match candidate") {
		t.Fatal(reasonDetail(t, v, qc.CheckLanguage))
	}

	unsupported := baseline()
	unsupported.Candidate.Language = "ja"
	mustFail(t, unsupported, 0.9, []string{qc.CheckLanguage}, 8500)
}

func TestEmptyInput(t *testing.T) {
	mustFail(t, qc.Input{}, 0.9, []string{qc.CheckLength, qc.CheckLanguage}, 7000)
}

func TestUnknownChannel(t *testing.T) {
	in := baseline()
	in.Draft.Channel = "sms"
	v := mustFail(t, in, 0.9, []string{qc.CheckLength}, 8500)
	if reasonDetail(t, v, qc.CheckLength) != "unknown channel" {
		t.Fatal(reasonDetail(t, v, qc.CheckLength))
	}
}

func TestThresholdRejected(t *testing.T) {
	bad := []float64{math.NaN(), math.Inf(1), math.Inf(-1), -0.01, 1.01}
	for _, threshold := range bad {
		_, err := qc.Evaluate(baseline(), threshold)
		if err == nil {
			t.Fatalf("threshold %v accepted", threshold)
		}
	}
}

func TestEvaluateIgnoresProcessEnv(t *testing.T) {
	t.Setenv(qc.EnvQCPassThreshold, "not-a-number")
	mustPass(t, baseline(), 0.9)
}

func TestReasonsAreCopied(t *testing.T) {
	v := mustPass(t, baseline(), 0.9)
	got := v.Reasons()
	got[0].Pass = false
	got[0].Detail = "mutated"
	again := v.Reasons()
	if !again[0].Pass || again[0].Detail == "mutated" {
		t.Fatalf("reasons aliased: %#v", again[0])
	}
}

func TestEvaluateDoesNotRetainInput(t *testing.T) {
	in := baseline()
	v, err := qc.Evaluate(in, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	in.Draft.Body = "{{name}} young woman guaranteed salary"
	in.Draft.Claims = nil
	if v.Status() != qc.StatusPass || v.Score() != 1 {
		t.Fatalf("result followed later edits: %s %v", v.Status(), v.Score())
	}
}

func TestDeterministic(t *testing.T) {
	in := baseline()
	first, err := qc.Evaluate(in, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	if first.QCVersion() != "qc.v1" || (first.Status() != qc.StatusPass && first.Status() != qc.StatusFail) || len(first.Reasons()) != 7 {
		t.Fatalf("not a verdict: %s %s %d", first.Status(), first.QCVersion(), len(first.Reasons()))
	}
	for i := 0; i < 20; i++ {
		next, err := qc.Evaluate(in, 0.9)
		if err != nil {
			t.Fatal(err)
		}
		if next.Status() != first.Status() || next.Score() != first.Score() || next.QCVersion() != first.QCVersion() {
			t.Fatal("not deterministic")
		}
		if strings.Join(details(next), "\n") != strings.Join(details(first), "\n") {
			t.Fatal("reasons changed")
		}
	}
}

func TestConcurrentEvaluate(t *testing.T) {
	in := baseline()
	var wg sync.WaitGroup
	errCh := make(chan string, 32)
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, err := qc.Evaluate(in, 0.9)
			if err != nil || v.Status() != qc.StatusPass || v.Score() != 1 {
				errCh <- "mismatch"
			}
		}()
	}
	wg.Wait()
	close(errCh)
	if _, ok := <-errCh; ok {
		t.Fatal("concurrent evaluate mismatch")
	}
}

func TestJSONShape(t *testing.T) {
	res, err := qc.Evaluate(baseline(), 0.9)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(res)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"status", "score", "qc_version", "reasons"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("missing %s in %s", key, raw)
		}
	}
	if len(payload) != 4 {
		t.Fatalf("keys %d: %s", len(payload), raw)
	}
	if string(payload["status"]) != `"PASS"` || string(payload["qc_version"]) != `"qc.v1"` || string(payload["score"]) != "1" {
		t.Fatalf("payload %s", raw)
	}
}

func details(v qc.Verdict) []string {
	out := make([]string, 0, 7)
	for _, reason := range v.Reasons() {
		out = append(out, reason.Check+"="+reason.Detail)
	}
	return out
}
