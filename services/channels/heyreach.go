package channels

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const heyReachSendPath = "api/public/inbox/SendMessage"

// Prepare freezes the HeyReach message. The body is not rewritten.
func (h *HeyReach) Prepare(ctx context.Context, draft Draft) (ExactText, error) {
	if err := ctxErr(ctx); err != nil {
		return ExactText{}, err
	}
	if strings.TrimSpace(draft.Channel) != "" {
		channel, err := CanonicalChannel(draft.Channel)
		if err != nil || channel != "heyreach" {
			return ExactText{}, ErrChannel
		}
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
	return ExactText{
		Channel:   "heyreach",
		Recipient: recipient,
		Subject:   subject,
		Body:      draft.Body,
		BodyHash:  BodyHash(draft.Body),
	}, nil
}

// Send posts the frozen message to the HeyReach public inbox API, or refuses.
func (h *HeyReach) Send(ctx context.Context, msg ApprovedMessage) (SendResult, error) {
	ctx = orBackground(ctx)
	now := h.now()
	exact, err := authorize(h.cfg.Env, h.cfg.TokenKey, now, msg, "heyreach", []string{"ARIA_HEYREACH_KILL_SWITCH"}, false)
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	if msg.SenderAccountID <= 0 {
		return h.refuse(ctx, now, msg, exact, ErrConfig)
	}
	endpoint, apiKey, err := h.destination()
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	daily, err := parseCap(h.cfg.Env, "ARIA_HEYREACH_SENDER_DAILY_CAP")
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	if daily <= 0 {
		return h.refuse(ctx, now, msg, exact, ErrDailyCap)
	}
	weekly, err := parseCap(h.cfg.Env, "ARIA_HEYREACH_SENDER_WEEKLY_CAP")
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	if weekly <= 0 {
		return h.refuse(ctx, now, msg, exact, ErrWeeklyCap)
	}
	gap, err := parseGap(h.cfg.Env)
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	pauseKeys := []string{senderKey(msg.SenderID), accountKey(msg.SenderAccountID)}
	release, err := h.limits.reserve(msg.SenderID, now, daily, weekly, gap, pauseKeys)
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	if err := postChatter(ctx, h.cfg.Auditor, now, "authorized", "", msg, exact); err != nil {
		release(false)
		return SendResult{}, ErrAudit
	}
	if err := ctx.Err(); err != nil {
		release(false)
		return SendResult{}, err
	}
	warning, err := h.postMessage(ctx, endpoint, apiKey, exact, msg.SenderAccountID)
	if warning {
		release(false)
		h.limits.pause(pauseKeys...)
		_ = postChatter(ctx, h.cfg.Auditor, now, "refused", ErrAccountWarning.Reason, msg, exact)
		return SendResult{}, ErrAccountWarning
	}
	if err != nil {
		release(false)
		_ = postChatter(ctx, h.cfg.Auditor, now, "refused", ErrDelivery.Reason, msg, exact)
		return SendResult{}, ErrDelivery
	}
	release(true)
	if err := postChatter(ctx, h.cfg.Auditor, now, "delivered", "", msg, exact); err != nil {
		return SendResult{}, ErrAudit
	}
	return SendResult{
		Channel:   exact.Channel,
		Recipient: exact.Recipient,
		BodyHash:  exact.BodyHash,
		SenderID:  msg.SenderID,
	}, nil
}

func (h *HeyReach) refuse(ctx context.Context, now time.Time, msg ApprovedMessage, exact ExactText, reason error) (SendResult, error) {
	if exact.Channel == "" {
		exact = msg.Exact
	}
	if err := postChatter(ctx, h.cfg.Auditor, now, "refused", reasonOf(reason), msg, exact); err != nil {
		return SendResult{}, err
	}
	return SendResult{}, reason
}

func (h *HeyReach) now() time.Time {
	if h.cfg.Clock == nil {
		return time.Now()
	}
	return h.cfg.Clock.Now()
}

func (h *HeyReach) destination() (*url.URL, string, error) {
	raw, ok := h.cfg.Env.Lookup("HEYREACH_BASE_URL")
	if !ok {
		return nil, "", ErrConfig
	}
	base, err := validateHTTPURL(raw, true)
	if err != nil {
		return nil, "", ErrConfig
	}
	joined, err := url.JoinPath(base.String(), heyReachSendPath)
	if err != nil {
		return nil, "", ErrConfig
	}
	endpoint, err := url.Parse(joined)
	if err != nil || endpoint.Host != base.Host || !strings.HasSuffix(endpoint.Path, "/"+heyReachSendPath) {
		return nil, "", ErrConfig
	}
	apiKey, ok := h.cfg.Env.Lookup("HEYREACH_API_KEY")
	if !ok || strings.TrimSpace(apiKey) == "" {
		return nil, "", ErrConfig
	}
	return endpoint, apiKey, nil
}

func (h *HeyReach) postMessage(ctx context.Context, endpoint *url.URL, apiKey string, exact ExactText, accountID int64) (bool, error) {
	// Field names match POST /api/public/inbox/SendMessage on the public API.
	payload := map[string]any{
		"message":           exact.Body,
		"subject":           exact.Subject,
		"conversationId":    exact.Recipient,
		"linkedInAccountId": accountID,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-KEY", apiKey)
	req.Header.Set("User-Agent", "aria-channels")
	resp, err := h.client().Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	buf, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return false, err
	}
	if accountWarning(buf) {
		return true, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, ErrDelivery
	}
	return false, nil
}

func (h *HeyReach) client() *http.Client {
	base := h.cfg.HTTP
	if base == nil {
		base = &http.Client{Transport: &http.Transport{Proxy: nil}}
	}
	clone := *base
	clone.Jar = nil
	clone.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	if clone.Timeout == 0 {
		clone.Timeout = 10 * time.Second
	}
	if clone.Transport == nil {
		clone.Transport = &http.Transport{Proxy: nil}
	}
	return &clone
}

func accountWarning(body []byte) bool {
	var payload struct {
		ErrorMessage   string `json:"errorMessage"`
		AccountWarning bool   `json:"accountWarning"`
		Code           string `json:"code"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return false
	}
	if payload.AccountWarning {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(payload.Code)) {
	case "account_warning", "sender_restricted":
		return true
	}
	message := strings.ToLower(payload.ErrorMessage)
	return strings.Contains(message, "account warning") ||
		strings.Contains(message, "sender restricted") ||
		strings.Contains(message, "restricted account")
}
