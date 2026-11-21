package channels

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEmailPrepareFreezesNoticeAndUnsubscribe(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	exact, err := rig.email.Prepare(context.Background(), emailDraft())
	if err != nil {
		t.Fatal(err)
	}
	if exact.Channel != "email" {
		t.Fatalf("channel = %s", exact.Channel)
	}
	if exact.Recipient != adaRecipient {
		t.Fatalf("recipient = %s", exact.Recipient)
	}
	if exact.Subject != "A role" {
		t.Fatalf("subject = %q", exact.Subject)
	}
	if exact.Body != expectedEmailBody() {
		t.Fatalf("body = %q", exact.Body)
	}
	if exact.BodyHash != wantPreparedHash {
		t.Fatalf("hash = %s", exact.BodyHash)
	}
	if !strings.Contains(exact.Body, lawfulBasis) || !strings.Contains(exact.Body, noticeSentence) {
		t.Fatal("lawful-basis notice missing from exact text")
	}
	if !strings.Contains(exact.Body, unsubscribeURL) || !strings.Contains(exact.Body, "Unsubscribe:") {
		t.Fatal("unsubscribe link missing from exact text")
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("Prepare delivered mail")
	}
}

func TestEmailPrepareRejectsMissingComplianceFields(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	cases := []struct {
		name   string
		mutate func(*Draft)
		want   error
	}{
		{"no basis", func(d *Draft) { d.LawfulBasis = "  " }, ErrLawfulBasis},
		{"no link", func(d *Draft) { d.UnsubscribeURL = "" }, ErrUnsubscribe},
		{"cleartext public link", func(d *Draft) { d.UnsubscribeURL = "http://example.com/unsub" }, ErrUnsubscribe},
		{"embedded credentials", func(d *Draft) { d.UnsubscribeURL = "https://user:pass@example.com/unsub" }, ErrUnsubscribe},
		{"header injection in subject", func(d *Draft) { d.Subject = "Hello\r\nBcc: victim@example.com" }, ErrConfig},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			draft := emailDraft()
			tc.mutate(&draft)
			_, err := rig.email.Prepare(context.Background(), draft)
			if !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestEmailSendDeliversExactBodyAndChatter(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	msg := rig.approved(t, CampaignMode{ID: "camp-synthetic", Mode: ""})
	result, err := rig.email.Send(context.Background(), msg)
	if err != nil {
		t.Fatal(err)
	}
	sent := rig.mailer.snapshot()
	if len(sent) != 1 {
		t.Fatalf("sent %d", len(sent))
	}
	if sent[0].To != adaRecipient || sent[0].Body != msg.Exact.Body || sent[0].Subject != msg.Exact.Subject {
		t.Fatalf("mail = %+v", sent[0])
	}
	if sent[0].Headers["List-Unsubscribe"] != "<"+unsubscribeURL+">" {
		t.Fatalf("List-Unsubscribe = %q", sent[0].Headers["List-Unsubscribe"])
	}
	if sent[0].Headers["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Fatalf("List-Unsubscribe-Post = %q", sent[0].Headers["List-Unsubscribe-Post"])
	}
	if result.BodyHash != wantPreparedHash || result.Recipient != adaRecipient {
		t.Fatalf("result = %+v", result)
	}
	notes := rig.audit.snapshot()
	if len(notes) < 1 {
		t.Fatal("no chatter note")
	}
	var delivered *MailMessage
	for i := range notes {
		if strings.Contains(notes[i].Body, "outcome=delivered") {
			delivered = &notes[i]
		}
	}
	if delivered == nil {
		t.Fatalf("notes = %+v", notes)
	}
	if delivered.Model != "aria.campaign" || delivered.ResID != 42 || delivered.MessageType != "notification" || delivered.SubtypeXMLID != "mail.mt_note" || !delivered.IsInternal {
		t.Fatalf("chatter = %+v", delivered)
	}
	raw, err := json.Marshal(delivered)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"res_id", "message_type", "subtype_xmlid", "email_from", "record_name"} {
		if !strings.Contains(string(raw), `"`+field+`"`) {
			t.Fatalf("json missing %s: %s", field, raw)
		}
	}
}

func TestEmailSendRefusesTokenOverDraftInsteadOfExactText(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	exact, err := rig.email.Prepare(context.Background(), emailDraft())
	if err != nil {
		t.Fatal(err)
	}
	draftOnly := exact
	draftOnly.Body = draftBody
	draftOnly.BodyHash = BodyHash(draftBody)
	tok := mint(t, draftOnly, CampaignMode{}, "recruiting@example.com", 0, rig.clock.Now())
	msg := ApprovedMessage{
		Exact: exact, Token: tok, DeliverTo: adaRecipient, From: "recruiting@example.com", SenderID: "sender-synthetic-1",
	}
	_, err = rig.email.Send(context.Background(), msg)
	if !errors.Is(err, ErrBinding) {
		t.Fatalf("error = %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("mailer was called")
	}
}

func TestEmailSendEnforcesAllowlistOnDeliveryTarget(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	msg := rig.approved(t, CampaignMode{Mode: "manual"})
	msg.DeliverTo = "victim@example.com"
	_, err := rig.email.Send(context.Background(), msg)
	if !errors.Is(err, ErrAllowlist) {
		t.Fatalf("off-list target: %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("off-list target was delivered")
	}

	rig = newEmailRig(emailEnv(map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST": "ada@example.com bea@example.com",
	}))
	msg = rig.approved(t, CampaignMode{Mode: "manual"})
	msg.DeliverTo = "bea@example.com"
	_, err = rig.email.Send(context.Background(), msg)
	if !errors.Is(err, ErrBinding) {
		t.Fatalf("on-list substitute target: %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("substitute target was delivered")
	}
}

func TestEmailSendKillSwitchFailClosed(t *testing.T) {
	disengaged := []struct {
		name string
		set  bool
		val  string
	}{
		{"unset", false, ""},
		{"zero", true, "0"},
		{"false", true, "false"},
		{"off", true, "off"},
		{"false upper", true, "FALSE"},
		{"padded off", true, " Off "},
	}
	for _, tc := range disengaged {
		t.Run("open/"+tc.name, func(t *testing.T) {
			extra := map[string]string{}
			if tc.set {
				extra["ARIA_SEND_KILL_SWITCH"] = tc.val
			}
			rig := newEmailRig(emailEnv(extra))
			if _, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{})); err != nil {
				t.Fatal(err)
			}
			if len(rig.mailer.snapshot()) != 1 {
				t.Fatal("expected delivery when the kill switch is disengaged")
			}
		})
	}
	engaged := []string{"1", "true", "on", "yes", "no", "enabled", "", "2", "falsehood"}
	for _, value := range engaged {
		t.Run("closed/"+value, func(t *testing.T) {
			rig := newEmailRig(emailEnv(map[string]string{"ARIA_SEND_KILL_SWITCH": value}))
			_, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{}))
			if !errors.Is(err, ErrKillSwitch) {
				t.Fatalf("value %q: %v", value, err)
			}
			if len(rig.mailer.snapshot()) != 0 {
				t.Fatal("kill switch still delivered")
			}
			notes := rig.audit.snapshot()
			if len(notes) != 1 || !strings.Contains(notes[0].Body, "outcome=refused") || !strings.Contains(notes[0].Body, "reason=kill-switch") {
				t.Fatalf("audit = %+v", notes)
			}
		})
	}
}

func TestEmailSendModeDefaultsManualAndAutoNeedsOptInPlusQC(t *testing.T) {
	cases := []struct {
		name string
		mode CampaignMode
		want error
	}{
		{"default", CampaignMode{}, nil},
		{"manual word", CampaignMode{Mode: "manual"}, nil},
		{"auto without opt-in", CampaignMode{Mode: "auto", QCPass: true}, ErrMode},
		{"auto without qc", CampaignMode{Mode: "auto", AutoOptIn: true, QCPass: false}, ErrQC},
		{"auto ready", CampaignMode{Mode: "AUTO", AutoOptIn: true, QCPass: true}, nil},
		{"opt-in alone stays manual", CampaignMode{AutoOptIn: true, QCPass: true}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rig := newEmailRig(emailEnv(nil))
			_, err := rig.email.Send(context.Background(), rig.approved(t, tc.mode))
			if tc.want == nil && err != nil {
				t.Fatal(err)
			}
			if tc.want != nil && !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
			if tc.want != nil && len(rig.mailer.snapshot()) != 0 {
				t.Fatal("refused mode still delivered")
			}
		})
	}
}

func TestEmailSendHonorsPerSenderDailyCap(t *testing.T) {
	env := NewLiveEnv(map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST":    adaRecipient,
		"ARIA_SENDER_ALLOWLIST":       "recruiting@example.com,other@example.com",
		"ARIA_UNSUBSCRIBE_HOST":       "example.com",
		"ARIA_EMAIL_SENDER_DAILY_CAP": "1",
	})
	rig := newEmailRig(env)
	msg := rig.approved(t, CampaignMode{Mode: "manual"})
	if _, err := rig.email.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	again := msg
	again.Token = mint(t, again.Exact, again.Campaign, again.From, 0, rig.clock.Now())
	_, err := rig.email.Send(context.Background(), again)
	if !errors.Is(err, ErrDailyCap) {
		t.Fatalf("second send: %v", err)
	}
	other := msg
	other.From = "other@example.com"
	other.SenderID = "sender-synthetic-2"
	other.Token = mint(t, other.Exact, other.Campaign, other.From, 0, rig.clock.Now())
	if _, err := rig.email.Send(context.Background(), other); err != nil {
		t.Fatal(err)
	}
	rig.clock.Advance(24 * time.Hour)
	fresh := rig.approved(t, CampaignMode{Mode: "manual"})
	fresh.SenderID = "sender-synthetic-1"
	if _, err := rig.email.Send(context.Background(), fresh); err != nil {
		t.Fatalf("next day: %v", err)
	}
}

func TestEmailSendRefusesWhenDailyCapUnset(t *testing.T) {
	set := map[string]string{
		"ARIA_RECIPIENT_ALLOWLIST": adaRecipient,
		"ARIA_SENDER_ALLOWLIST":    "recruiting@example.com",
		"ARIA_UNSUBSCRIBE_HOST":    "example.com",
	}
	rig := newEmailRig(NewEnviron(set))
	_, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{}))
	if !errors.Is(err, ErrDailyCap) {
		t.Fatalf("error = %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("unset cap delivered")
	}
}

func TestEmailDailyCapIsRaceSafe(t *testing.T) {
	rig := newEmailRig(emailEnv(map[string]string{"ARIA_EMAIL_SENDER_DAILY_CAP": "1"}))
	base := rig.approved(t, CampaignMode{})
	msgs := make([]ApprovedMessage, 16)
	for i := range msgs {
		msgs[i] = base
		msgs[i].Token = mint(t, base.Exact, base.Campaign, base.From, 0, rig.clock.Now())
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	okCount := 0
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := rig.email.Send(context.Background(), msgs[i])
			if err == nil {
				mu.Lock()
				okCount++
				mu.Unlock()
			} else if !errors.Is(err, ErrDailyCap) {
				t.Errorf("error = %v", err)
			}
		}()
	}
	wg.Wait()
	if okCount != 1 {
		t.Fatalf("successes = %d, want 1", okCount)
	}
	if len(rig.mailer.snapshot()) != 1 {
		t.Fatalf("delivered %d", len(rig.mailer.snapshot()))
	}
}

func TestEmailMailboxErrorHoldsCap(t *testing.T) {
	rig := newEmailRig(emailEnv(map[string]string{"ARIA_EMAIL_SENDER_DAILY_CAP": "1"}))
	rig.mailer.err = errors.New("synthetic mailbox down")
	msg := rig.approved(t, CampaignMode{})
	if _, err := rig.email.Send(context.Background(), msg); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("first: %v", err)
	}
	rig.mailer.err = nil
	msg.Token = mint(t, msg.Exact, msg.Campaign, msg.From, 0, rig.clock.Now())
	if _, err := rig.email.Send(context.Background(), msg); !errors.Is(err, ErrDailyCap) {
		t.Fatalf("fresh token should see the held cap: %v", err)
	}
}

func TestEmailSendAuditFailureBlocksDelivery(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	rig.audit.err = errors.New("synthetic audit down")
	_, err := rig.email.Send(context.Background(), rig.approved(t, CampaignMode{}))
	if !errors.Is(err, ErrAudit) {
		t.Fatalf("error = %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("delivered without an audit note")
	}
}

func TestEmailSendRefusesStrippedNoticeEvenWithMatchingToken(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	exact := ExactText{
		Channel:   "email",
		Recipient: adaRecipient,
		Subject:   "A role",
		Body:      draftBody,
		BodyHash:  wantDraftHash,
	}
	tok := mint(t, exact, CampaignMode{}, "recruiting@example.com", 0, rig.clock.Now())
	_, err := rig.email.Send(context.Background(), ApprovedMessage{
		Exact: exact, Token: tok, DeliverTo: adaRecipient, From: "recruiting@example.com", SenderID: "sender-synthetic-1",
	})
	if !errors.Is(err, ErrLawfulBasis) && !errors.Is(err, ErrUnsubscribe) {
		t.Fatalf("error = %v", err)
	}
	if len(rig.mailer.snapshot()) != 0 {
		t.Fatal("notice-free body was delivered")
	}
}

func TestEmailUnsubscribeRequiresHttpsOnConfiguredHost(t *testing.T) {
	rig := newEmailRig(emailEnv(nil))
	for _, link := range []string{
		"http://127.0.0.1:8080/unsubscribe/synthetic",
		"http://example.com/unsubscribe/synthetic",
		"https://evil.example/unsubscribe/synthetic",
		"https://user:pass@example.com/unsubscribe/synthetic",
	} {
		draft := emailDraft()
		draft.UnsubscribeURL = link
		if _, err := rig.email.Prepare(context.Background(), draft); !errors.Is(err, ErrUnsubscribe) {
			t.Fatalf("%s: %v", link, err)
		}
	}
}
