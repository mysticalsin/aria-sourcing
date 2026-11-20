package channels

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	heyReachSendPath     = "api/public/inbox/SendMessage"
	heyReachOfficialHost = "api.heyreach.io"
)

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
	exact, err := authorize(h.cfg.Env, msg, "heyreach", []string{"ARIA_HEYREACH_KILL_SWITCH"}, false)
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	if msg.SenderAccountID <= 0 {
		return h.refuse(ctx, now, msg, exact, ErrConfig)
	}
	if err := h.paused(ctx, msg, now); err != nil {
		return h.refuse(ctx, now, msg, exact, err)
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
	threshold, window, pauseFor, err := errorPolicy(h.cfg.Env)
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	release, err := h.limits.reserve(msg.SenderID, now, daily, weekly, gap)
	if err != nil {
		return h.refuse(ctx, now, msg, exact, err)
	}
	if err := postChatter(ctx, h.cfg.Auditor, now, "authorized", "", msg, exact); err != nil {
		release(false)
		return SendResult{}, ErrAudit
	}
	nonce, err := verifyToken(h.cfg.TokenKey, msg.Token, heyReachBound(msg, exact), now)
	if err != nil {
		release(false)
		return h.refuse(ctx, now, msg, exact, err)
	}
	if err := h.cfg.Consumed.Consume(ctx, nonce); err != nil {
		release(false)
		return h.refuse(ctx, now, msg, exact, err)
	}
	if err := ctx.Err(); err != nil {
		release(false)
		return SendResult{}, err
	}
	warning, err := h.postMessage(ctx, endpoint, apiKey, exact, msg.SenderAccountID)
	if warning {
		release(false)
		h.noteFailure(ctx, msg, now, threshold, window, pauseFor)
		_ = h.cfg.Pauses.Pause(ctx, senderKey(msg.SenderID), time.Time{}, "account-warning")
		_ = h.cfg.Pauses.Pause(ctx, accountKey(msg.SenderAccountID), time.Time{}, "account-warning")
		_ = postChatter(ctx, h.cfg.Auditor, now, "refused", ErrAccountWarning.Reason, msg, exact)
		return SendResult{}, ErrAccountWarning
	}
	if err != nil {
		release(false)
		h.noteFailure(ctx, msg, now, threshold, window, pauseFor)
		_ = postChatter(ctx, h.cfg.Auditor, now, "refused", ErrDelivery.Reason, msg, exact)
		return SendResult{}, ErrDelivery
	}
	release(true)
	if err := postChatter(ctx, h.cfg.Auditor, now, "delivered", "", msg, exact); err != nil {
		return SendResult{}, ErrSentAuditFailed
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
	raw, ok := lookup(h.cfg.Env, "HEYREACH_BASE_URL")
	if !ok {
		return nil, "", ErrConfig
	}
	var err error
	if h.testOverride {
		err = validateTestHeyReachBase(raw)
	} else {
		err = validateOfficialHeyReachBase(raw)
	}
	if err != nil {
		return nil, "", err
	}
	base, err := url.Parse(strings.TrimSpace(raw))
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
	apiKey, ok := lookup(h.cfg.Env, "HEYREACH_API_KEY")
	if !ok || strings.TrimSpace(apiKey) == "" {
		return nil, "", ErrConfig
	}
	return endpoint, apiKey, nil
}

func (h *HeyReach) paused(ctx context.Context, msg ApprovedMessage, now time.Time) error {
	for _, key := range []string{senderKey(msg.SenderID), accountKey(msg.SenderAccountID)} {
		paused, err := h.cfg.Pauses.Paused(ctx, key, now)
		if err != nil {
			return err
		}
		if paused {
			return ErrPaused
		}
	}
	return nil
}

func (h *HeyReach) noteFailure(ctx context.Context, msg ApprovedMessage, now time.Time, threshold int, window, pauseFor time.Duration) {
	count, err := h.cfg.Pauses.NoteFailure(ctx, senderKey(msg.SenderID), now, window)
	if err != nil || count < threshold {
		return
	}
	until := now.Add(pauseFor)
	_ = h.cfg.Pauses.Pause(ctx, senderKey(msg.SenderID), until, "error-rate")
	_ = h.cfg.Pauses.Pause(ctx, accountKey(msg.SenderAccountID), until, "error-rate")
}

func heyReachBound(msg ApprovedMessage, exact ExactText) boundFields {
	return boundFields{
		exact:     exact,
		mode:      msg.Campaign.Mode,
		qcPass:    msg.Campaign.QCPass,
		autoOptIn: msg.Campaign.AutoOptIn,
		from:      msg.From,
		accountID: msg.SenderAccountID,
	}
}

func validateOfficialHeyReachBase(raw string) error {
	parsed, err := parseBase(raw)
	if err != nil {
		return ErrConfig
	}
	if parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), heyReachOfficialHost) || parsed.Port() != "" {
		return ErrConfig
	}
	if parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ErrConfig
	}
	return nil
}

func validateTestHeyReachBase(raw string) error {
	parsed, err := parseBase(raw)
	if err != nil {
		return ErrConfig
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ErrConfig
	}
	if !loopbackHost(parsed.Host) {
		return ErrConfig
	}
	return nil
}

func parseBase(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, "\r\n") {
		return nil, ErrConfig
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Hostname() == "" {
		return nil, ErrConfig
	}
	return parsed, nil
}

func errorPolicy(env LiveEnv) (int, time.Duration, time.Duration, error) {
	threshold := 3
	window := time.Hour
	pauseFor := time.Hour
	if raw, ok := lookup(env, "ARIA_HEYREACH_ERROR_THRESHOLD"); ok && strings.TrimSpace(raw) != "" {
		n, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || n < 1 {
			return 0, 0, 0, ErrConfig
		}
		threshold = n
	}
	if raw, ok := lookup(env, "ARIA_HEYREACH_ERROR_WINDOW_SECONDS"); ok && strings.TrimSpace(raw) != "" {
		n, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || n < 1 {
			return 0, 0, 0, ErrConfig
		}
		window = time.Duration(n) * time.Second
	}
	if raw, ok := lookup(env, "ARIA_HEYREACH_ERROR_PAUSE_SECONDS"); ok && strings.TrimSpace(raw) != "" {
		n, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || n < 1 {
			return 0, 0, 0, ErrConfig
		}
		pauseFor = time.Duration(n) * time.Second
	}
	return threshold, window, pauseFor, nil
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
