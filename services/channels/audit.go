package channels

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func postChatter(ctx context.Context, auditor Auditor, now time.Time, outcome, reason string, msg ApprovedMessage, exact ExactText) error {
	if auditor == nil {
		return ErrAudit
	}
	if err := auditor.PostChatter(ctx, chatterNote(now, outcome, reason, msg, exact)); err != nil {
		return ErrAudit
	}
	return nil
}

func chatterNote(now time.Time, outcome, reason string, msg ApprovedMessage, exact ExactText) MailMessage {
	model := strings.TrimSpace(msg.Record.Model)
	if model == "" {
		model = "aria.campaign"
	}
	from := strings.TrimSpace(msg.From)
	if from == "" || strings.ContainsAny(from, "\r\n \t") || !strings.Contains(from, "@") {
		from = "ARIA <aria@localhost>"
	}
	line := fmt.Sprintf(
		"channel=%s outcome=%s reason=%s sender=%s recipient=%s body_hash=%s campaign=%s",
		exact.Channel, outcome, reason, msg.SenderID, exact.Recipient, exact.BodyHash, msg.Campaign.ID,
	)
	return MailMessage{
		Model:        model,
		ResID:        msg.Record.ResID,
		MessageType:  "notification",
		SubtypeXMLID: "mail.mt_note",
		Subject:      "Outreach " + outcome,
		Body:         "<p>" + htmlEscape(line) + "</p>",
		Date:         now.UTC().Format("2006-01-02 15:04:05"),
		EmailFrom:    from,
		RecordName:   msg.Record.Name,
		IsInternal:   true,
	}
}

func htmlEscape(value string) string {
	return strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&#34;",
		"'", "&#39;",
	).Replace(value)
}

func reasonOf(err error) string {
	var refusal *Refusal
	if asRefusal(err, &refusal) {
		return refusal.Reason
	}
	return "refused"
}

func asRefusal(err error, target **Refusal) bool {
	if err == nil {
		return false
	}
	if refusal, ok := err.(*Refusal); ok {
		*target = refusal
		return true
	}
	return false
}
