package channels

// Refusal is a fail-closed send decision. Reason is a stable code.
type Refusal struct {
	Reason string
}

func (r *Refusal) Error() string {
	if r == nil || r.Reason == "" {
		return "refused"
	}
	return r.Reason
}

func (r *Refusal) Is(target error) bool {
	other, ok := target.(*Refusal)
	return ok && other != nil && r != nil && other.Reason == r.Reason
}

var (
	ErrKillSwitch      = &Refusal{Reason: "kill-switch"}
	ErrAllowlist       = &Refusal{Reason: "allowlist"}
	ErrToken           = &Refusal{Reason: "approval-token"}
	ErrExpired         = &Refusal{Reason: "approval-expired"}
	ErrBinding         = &Refusal{Reason: "binding-mismatch"}
	ErrMode            = &Refusal{Reason: "mode"}
	ErrQC              = &Refusal{Reason: "qc-required"}
	ErrDailyCap        = &Refusal{Reason: "daily-cap"}
	ErrWeeklyCap       = &Refusal{Reason: "weekly-cap"}
	ErrPacing          = &Refusal{Reason: "pacing"}
	ErrPaused          = &Refusal{Reason: "sender-paused"}
	ErrDisabled        = &Refusal{Reason: "disabled"}
	ErrAudit           = &Refusal{Reason: "audit"}
	ErrLawfulBasis     = &Refusal{Reason: "lawful-basis"}
	ErrUnsubscribe     = &Refusal{Reason: "unsubscribe"}
	ErrAccountWarning  = &Refusal{Reason: "account-warning"}
	ErrDelivery        = &Refusal{Reason: "delivery"}
	ErrConfig          = &Refusal{Reason: "config"}
	ErrChannel         = &Refusal{Reason: "channel"}
	ErrSender          = &Refusal{Reason: "sender"}
	ErrSenderAllowlist = &Refusal{Reason: "sender-allowlist"}
	ErrTokenUsed       = &Refusal{Reason: "token-used"}
	ErrOutcomeUnknown  = &Refusal{Reason: "outcome-unknown"}
)

// SentAuditError means the transport already accepted the message and the
// chatter write after that failed. Callers must not retry the same token.
type SentAuditError struct{}

func (SentAuditError) Error() string { return "sent-audit-failed" }

var ErrSentAuditFailed error = SentAuditError{}
