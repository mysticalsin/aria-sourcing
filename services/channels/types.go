package channels

import (
	"context"
	"net/http"
	"time"
)

// Channel prepares an exact outbound text and sends it only when the approval
// token and the send policy both allow that exact text.
type Channel interface {
	Prepare(ctx context.Context, draft Draft) (ExactText, error)
	Send(ctx context.Context, msg ApprovedMessage) (SendResult, error)
}

// Environ is an explicit environment. A key present in the map is set, even
// when its value is empty. A missing key is unset.
type Environ struct {
	vars map[string]string
}

// NewEnviron copies set. Every key in set is treated as present.
func NewEnviron(set map[string]string) Environ {
	vars := make(map[string]string, len(set))
	for key, value := range set {
		vars[key] = value
	}
	return Environ{vars: vars}
}

// Lookup reports whether key was set and returns its raw value.
func (e Environ) Lookup(key string) (string, bool) {
	if e.vars == nil {
		return "", false
	}
	value, ok := e.vars[key]
	return value, ok
}

// Draft is the operator-facing text before it is frozen for approval.
type Draft struct {
	Channel        string
	Recipient      string
	Subject        string
	Body           string
	LawfulBasis    string
	UnsubscribeURL string
	SenderID       string
	From           string
}

// ExactText is the precise payload a send would deliver.
type ExactText struct {
	Channel        string
	Recipient      string
	Subject        string
	Body           string
	BodyHash       string
	LawfulBasis    string
	UnsubscribeURL string
}

// CampaignMode is the per-campaign send policy supplied with a send.
// Manual is the default. Auto requires an explicit opt-in and a QC pass.
type CampaignMode struct {
	ID        string
	AutoOptIn bool
	QCPass    bool
	Mode      string
}

// MailRecord is the Odoo document a chatter note is attached to.
type MailRecord struct {
	Model string
	ResID int64
	Name  string
}

// ApprovedMessage is a frozen text plus the approval token and the real
// delivery target. DeliverTo is the address or conversation the adapter will
// hand to the transport, and it is the value the allowlist is applied to.
type ApprovedMessage struct {
	Exact           ExactText
	Token           string
	DeliverTo       string
	From            string
	SenderID        string
	SenderAccountID int64
	Campaign        CampaignMode
	Record          MailRecord
}

// SendResult describes one accepted delivery.
type SendResult struct {
	Channel   string
	Recipient string
	BodyHash  string
	SenderID  string
}

// OutboundMail is a structured message. Transports must not concatenate these
// fields into headers without their own escaping.
type OutboundMail struct {
	From    string
	To      string
	Subject string
	Body    string
	Headers map[string]string
}

// SMTP delivers one email. A production host injects a real SMTP client.
// This module never dials one; tests pass an in-memory fake.
type SMTP interface {
	Send(ctx context.Context, mail OutboundMail) error
}

// MailMessage is the mail.message shape Odoo stores for a chatter entry.
type MailMessage struct {
	Model        string `json:"model"`
	ResID        int64  `json:"res_id"`
	MessageType  string `json:"message_type"`
	SubtypeXMLID string `json:"subtype_xmlid"`
	Subject      string `json:"subject"`
	Body         string `json:"body"`
	Date         string `json:"date"`
	EmailFrom    string `json:"email_from"`
	RecordName   string `json:"record_name"`
	IsInternal   bool   `json:"is_internal"`
}

// Auditor records one chatter note. The HeyReach adapter never talks to Odoo
// itself; the host process supplies this interface.
type Auditor interface {
	PostChatter(ctx context.Context, msg MailMessage) error
}

// Clock supplies the instant used for expiry, caps, and pacing.
type Clock interface {
	Now() time.Time
}

// EmailConfig wires the email adapter. TokenKey verifies ledger tokens.
type EmailConfig struct {
	Env      Environ
	TokenKey []byte
	SMTP     SMTP
	Auditor  Auditor
	Clock    Clock
}

// HeyReachConfig wires the HeyReach public-API adapter.
type HeyReachConfig struct {
	Env      Environ
	TokenKey []byte
	Auditor  Auditor
	Clock    Clock
	HTTP     *http.Client
}

// Email sends through an injected Mailer.
type Email struct {
	cfg    EmailConfig
	limits *senderLimits
}

// HeyReach sends through the official public inbox API at HEYREACH_BASE_URL.
type HeyReach struct {
	cfg    HeyReachConfig
	limits *senderLimits
}

// NewEmail returns an email adapter. Caps live in this process.
func NewEmail(cfg EmailConfig) *Email {
	return &Email{cfg: cfg, limits: newSenderLimits()}
}

// NewHeyReach returns a HeyReach adapter. Caps and pauses live in this process.
func NewHeyReach(cfg HeyReachConfig) *HeyReach {
	return &HeyReach{cfg: cfg, limits: newSenderLimits()}
}

var (
	_ Channel = (*Email)(nil)
	_ Channel = (*HeyReach)(nil)
)
