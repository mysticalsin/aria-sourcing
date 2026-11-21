package channels

import (
	"context"
	"net/url"
	"strings"
	"time"
)

const transparencyNotice = "Notice: GDPR Article 14 and LGPD. You were not the source of this contact data. You may request access, correction, or deletion, and you may object to this use."

// Prepare freezes the email body, including the lawful-basis notice and the
// unsubscribe link, so the approval hash covers the text that will be sent.
func (e *Email) Prepare(ctx context.Context, draft Draft) (ExactText, error) {
	if err := ctxErr(ctx); err != nil {
		return ExactText{}, err
	}
	if strings.TrimSpace(draft.Channel) != "" {
		channel, err := CanonicalChannel(draft.Channel)
		if err != nil || channel != "email" {
			return ExactText{}, ErrChannel
		}
	}
	basis := strings.TrimSpace(draft.LawfulBasis)
	if basis == "" {
		return ExactText{}, ErrLawfulBasis
	}
	host, _ := lookup(e.cfg.Env, "ARIA_UNSUBSCRIBE_HOST")
	link, err := validateUnsubscribe(draft.UnsubscribeURL, host)
	if err != nil {
		return ExactText{}, err
	}
	recipient, err := CanonicalRecipient(draft.Recipient)
	if err != nil {
		return ExactText{}, err
	}
	subject, err := CanonicalSubject(draft.Subject)
	if err != nil {
		return ExactText{}, err
	}
	if strings.TrimSpace(draft.Body) == "" {
		return ExactText{}, ErrConfig
	}
	body := composeEmailBody(draft.Body, basis, link)
	return ExactText{
		Channel:        "email",
		Recipient:      recipient,
		Subject:        subject,
		Body:           body,
		BodyHash:       BodyHash(body),
		LawfulBasis:    basis,
		UnsubscribeURL: link,
	}, nil
}

// Send delivers the frozen email or refuses. The recipient allowlist is
// applied to DeliverTo, which is also the address handed to the Mailer.
func (e *Email) Send(ctx context.Context, msg ApprovedMessage) (SendResult, error) {
	ctx = orBackground(ctx)
	now := e.now()
	exact, err := authorize(e.cfg.Env, msg, "email", nil, true)
	if err != nil {
		return e.refuse(ctx, now, msg, exact, err)
	}
	if err := validateFrom(msg.From); err != nil {
		return e.refuse(ctx, now, msg, exact, err)
	}
	nonce, err := verifyToken(e.cfg.TokenKey, msg.Token, emailBound(msg, exact), now)
	if err != nil {
		return e.refuse(ctx, now, msg, exact, err)
	}
	if err := e.cfg.Consumed.Reserve(ctx, nonce); err != nil {
		return e.refuse(ctx, now, msg, exact, err)
	}
	daily, err := parseCap(e.cfg.Env, "ARIA_EMAIL_SENDER_DAILY_CAP")
	if err != nil {
		_ = e.cfg.Consumed.Release(context.Background(), nonce)
		return e.refuse(ctx, now, msg, exact, err)
	}
	if daily <= 0 {
		_ = e.cfg.Consumed.Release(context.Background(), nonce)
		return e.refuse(ctx, now, msg, exact, ErrDailyCap)
	}
	account, err := providerAccount("email", msg.From, 0)
	if err != nil {
		_ = e.cfg.Consumed.Release(context.Background(), nonce)
		return e.refuse(ctx, now, msg, exact, err)
	}
	release, err := e.limits.reserve(account, now, daily, 0, 0)
	if err != nil {
		_ = e.cfg.Consumed.Release(context.Background(), nonce)
		return e.refuse(ctx, now, msg, exact, err)
	}
	if err := postChatter(ctx, e.cfg.Auditor, now, "authorized", "", msg, exact); err != nil {
		_ = e.cfg.Consumed.Release(context.Background(), nonce)
		release(false)
		return SendResult{}, ErrAudit
	}
	if err := ctx.Err(); err != nil {
		_ = e.cfg.Consumed.Release(context.Background(), nonce)
		release(false)
		return SendResult{}, err
	}
	if e.cfg.SMTP == nil {
		_ = e.cfg.Consumed.Release(context.Background(), nonce)
		release(false)
		return SendResult{}, ErrConfig
	}
	outbound := OutboundMail{
		From:    strings.TrimSpace(msg.From),
		To:      exact.Recipient,
		Subject: exact.Subject,
		Body:    exact.Body,
		Headers: map[string]string{
			"List-Unsubscribe":      "<" + exact.UnsubscribeURL + ">",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	}
	if err := e.cfg.SMTP.Send(ctx, outbound); err != nil {
		_ = e.cfg.Consumed.MarkUnknown(context.Background(), nonce)
		release(true)
		_ = postChatter(ctx, e.cfg.Auditor, now, "unknown", ErrOutcomeUnknown.Reason, msg, exact)
		return SendResult{}, ErrOutcomeUnknown
	}
	_ = e.cfg.Consumed.Commit(context.Background(), nonce)
	release(true)
	if err := postChatter(ctx, e.cfg.Auditor, now, "delivered", "", msg, exact); err != nil {
		return SendResult{}, ErrSentAuditFailed
	}
	return SendResult{
		Channel:   exact.Channel,
		Recipient: exact.Recipient,
		BodyHash:  exact.BodyHash,
		SenderID:  msg.SenderID,
	}, nil
}

func (e *Email) refuse(ctx context.Context, now time.Time, msg ApprovedMessage, exact ExactText, reason error) (SendResult, error) {
	if exact.Channel == "" {
		exact = msg.Exact
	}
	if err := postChatter(ctx, e.cfg.Auditor, now, "refused", reasonOf(reason), msg, exact); err != nil {
		return SendResult{}, err
	}
	return SendResult{}, reason
}

func (e *Email) now() time.Time {
	if e.cfg.Clock == nil {
		return time.Now()
	}
	return e.cfg.Clock.Now()
}

func composeEmailBody(body, lawfulBasis, unsubscribeURL string) string {
	return body + "\n\n" +
		"Why you are receiving this: " + lawfulBasis + "\n" +
		transparencyNotice + "\n" +
		"Unsubscribe: " + unsubscribeURL + "\n"
}

func requireEmailNotice(exact ExactText) error {
	basis := strings.TrimSpace(exact.LawfulBasis)
	if basis == "" || !strings.Contains(exact.Body, basis) || !strings.Contains(exact.Body, transparencyNotice) {
		return ErrLawfulBasis
	}
	link := strings.TrimSpace(exact.UnsubscribeURL)
	if link == "" || !strings.Contains(exact.Body, link) || !strings.Contains(exact.Body, "Unsubscribe:") {
		return ErrUnsubscribe
	}
	return nil
}

func validateUnsubscribe(raw, configuredHost string) (string, error) {
	raw = strings.TrimSpace(raw)
	host := strings.ToLower(strings.TrimSpace(configuredHost))
	if raw == "" || host == "" || strings.ContainsAny(raw, "\r\n<>") || strings.Contains(host, "/") {
		return "", ErrUnsubscribe
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || parsed.Hostname() == "" || parsed.Port() != "" {
		return "", ErrUnsubscribe
	}
	if parsed.Scheme != "https" || strings.ToLower(parsed.Hostname()) != host {
		return "", ErrUnsubscribe
	}
	return raw, nil
}

func emailBound(msg ApprovedMessage, exact ExactText) boundFields {
	return boundFields{
		exact:          exact,
		unsubscribeURL: exact.UnsubscribeURL,
		mode:           msg.Campaign.Mode,
		qcPass:         msg.Campaign.QCPass,
		autoOptIn:      msg.Campaign.AutoOptIn,
		from:           msg.From,
		accountID:      msg.SenderAccountID,
	}
}

func validateFrom(from string) error {
	from = strings.TrimSpace(from)
	if from == "" || strings.ContainsAny(from, "\r\n \t") || !strings.Contains(from, "@") {
		return ErrSender
	}
	return nil
}

func orBackground(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
