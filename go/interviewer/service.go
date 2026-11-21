package interviewer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	maxBody       = 1 << 20
	attemptBudget = 2 // one try plus one retry
)

// Logger receives operational lines. Implementations must tolerate the
// adapter never passing the API key, the webhook secret, or the need summary.
type Logger interface {
	Printf(format string, args ...any)
}

// Option configures a Service.
type Option func(*Service)

// WithLogger records failures without secrets.
func WithLogger(l Logger) Option {
	return func(s *Service) { s.log = l }
}

// WithTransport replaces the HTTP transport. Tests use it to prove a call
// did not leave the process.
func WithTransport(rt http.RoundTripper) Option {
	return func(s *Service) { s.transport = rt }
}

// Service is the hand-off adapter. It is safe for concurrent use.
type Service struct {
	cfg       Config
	transport http.RoundTripper
	log       Logger
}

// New builds an adapter. A zero HTTPTimeout is bounded to five seconds.
// A disabled config is valid and performs no I/O.
func New(cfg Config, opts ...Option) *Service {
	if cfg.HTTPTimeout <= 0 {
		cfg.HTTPTimeout = defaultHTTPTimeout
	}
	s := &Service{cfg: cfg, transport: defaultTransport()}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	if s.transport == nil {
		s.transport = defaultTransport()
	}
	return s
}

func defaultTransport() *http.Transport {
	return &http.Transport{
		Proxy:                 nil,
		DisableKeepAlives:     true,
		DialContext:           (&net.Dialer{Timeout: defaultHTTPTimeout}).DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   defaultHTTPTimeout,
		ExpectContinueTimeout: time.Second,
	}
}

type screeningRequest struct {
	NeedSummary   string   `json:"need_summary"`
	RoleQuestions []string `json:"role_questions"`
	CandidateID   string   `json:"candidate_id"`
	Language      string   `json:"language"`
	Consent       bool     `json:"consent"`
}

// RequestScreening posts a screening when the candidate is in to_interview
// and a human approval is on record. The feature flag is checked first.
// The returned stage is the candidate's stage; it is never changed here.
func (s *Service) RequestScreening(ctx context.Context, c Candidate, n Need) (Handoff, error) {
	if ctx == nil {
		return Handoff{}, fmt.Errorf("%w: nil context", ErrValidation)
	}
	refused := Handoff{State: StateNotRequested, Stage: c.Stage}
	if !s.cfg.Enabled {
		return refused, ErrDisabled
	}
	if err := ctx.Err(); err != nil {
		return refused, err
	}
	if err := validateEligibility(c, n); err != nil {
		return refused, err
	}
	if strings.TrimSpace(s.cfg.APIKey) == "" {
		return refused, fmt.Errorf("%w: api key", ErrValidation)
	}
	if err := ValidateBaseURL(s.cfg.BaseURL); err != nil {
		return refused, err
	}
	payload, err := json.Marshal(screeningRequest{
		NeedSummary:   strings.TrimSpace(n.Summary),
		RoleQuestions: trimmedQuestions(n.RoleQuestions),
		CandidateID:   c.ID,
		Language:      c.Language,
		Consent:       true,
	})
	if err != nil {
		return refused, fmt.Errorf("%w: request", ErrValidation)
	}
	key := IdempotencyKey(c.ID, n.ID, strings.TrimSpace(c.ApprovalID))
	refused.IdempotencyKey = key
	body, err := s.call(ctx, http.MethodPost, "", payload, key)
	if err != nil {
		return refused, err
	}
	current := Handoff{State: StateNotRequested, Stage: c.Stage, IdempotencyKey: key}
	return s.observe(current, body, true)
}

// Poll reads the screening the interviewer already accepted.
// A timeout leaves the hand-off where it was.
func (s *Service) Poll(ctx context.Context, current Handoff) (Handoff, error) {
	if ctx == nil {
		return current, fmt.Errorf("%w: nil context", ErrValidation)
	}
	if !s.cfg.Enabled {
		return current, ErrDisabled
	}
	if err := ctx.Err(); err != nil {
		return current, err
	}
	if !screeningIDPattern.MatchString(current.ScreeningID) {
		return current, fmt.Errorf("%w: screening id", ErrValidation)
	}
	body, err := s.call(ctx, http.MethodGet, current.ScreeningID, nil, current.IdempotencyKey)
	if err != nil {
		return current, err
	}
	return s.observe(current, body, false)
}

// AcceptWebhook verifies the raw body and folds the result into current.
// The signature is HMAC-SHA256 in SignatureHeader. A failed check does not
// change state. The feature flag short-circuits before the body is parsed.
func (s *Service) AcceptWebhook(ctx context.Context, current Handoff, body []byte, signature string) (Handoff, error) {
	if !s.cfg.Enabled {
		return current, ErrDisabled
	}
	if ctx == nil {
		return current, fmt.Errorf("%w: nil context", ErrValidation)
	}
	if len(body) > maxBody {
		return current, fmt.Errorf("%w: webhook body", ErrValidation)
	}
	if !VerifySignature(s.cfg.WebhookSecret, body, signature) {
		return current, ErrSignature
	}
	if len(body) == 0 {
		return current, fmt.Errorf("%w: webhook body", ErrValidation)
	}
	return s.observe(current, body, false)
}

func (s *Service) observe(current Handoff, payload []byte, chain bool) (Handoff, error) {
	var remote remoteScreening
	if err := json.Unmarshal(payload, &remote); err != nil {
		return current, fmt.Errorf("%w: payload", ErrValidation)
	}
	if !screeningIDPattern.MatchString(remote.ID) {
		return current, fmt.Errorf("%w: screening id", ErrValidation)
	}
	if current.ScreeningID != "" && current.ScreeningID != remote.ID {
		return current, fmt.Errorf("%w: screening id", ErrValidation)
	}
	next, err := StateFromRemote(remote.Status)
	if err != nil {
		return current, err
	}
	var report *Report
	if next == StateCompleted {
		rep, err := remote.report()
		if err != nil {
			return current, err
		}
		report = &rep
	}
	return applyState(current, remote.ID, next, report, chain)
}

func applyState(current Handoff, id string, next State, report *Report, chain bool) (Handoff, error) {
	if current.State == StateCompleted && next == StateCompleted {
		if current.Report != nil && report != nil && report.Recommendation != current.Report.Recommendation {
			return current, fmt.Errorf("%w: recommendation changed", ErrTransition)
		}
		out := current
		out.StageChanged = false
		out.AutoRejected = false
		if out.Report != nil {
			out.Report.Advisory = true
		}
		return out, nil
	}
	if err := advance(current.State, next, chain); err != nil {
		return current, err
	}
	out := current
	out.State = next
	out.ScreeningID = id
	out.StageChanged = false
	out.AutoRejected = false
	if next == StateCompleted && report != nil {
		rep := *report
		rep.Advisory = true
		out.Report = &rep
	}
	return out, nil
}

func advance(from, to State, chain bool) error {
	if err := Transition(from, to); err == nil {
		return nil
	}
	if chain && from == StateNotRequested && to != StateRequested {
		if err := Transition(StateNotRequested, StateRequested); err != nil {
			return err
		}
		return Transition(StateRequested, to)
	}
	return Transition(from, to)
}

func (s *Service) call(ctx context.Context, method, id string, payload []byte, idemKey string) ([]byte, error) {
	endpoint, err := endpointURL(s.cfg.BaseURL, id)
	if err != nil {
		return nil, err
	}
	var lastStatus int
	for attempt := 0; attempt < attemptBudget; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		attemptCtx, cancel := context.WithTimeout(ctx, s.cfg.HTTPTimeout)
		req, err := http.NewRequestWithContext(attemptCtx, method, endpoint, bytes.NewReader(payload))
		if err != nil {
			cancel()
			return nil, fmt.Errorf("%w: request", ErrValidation)
		}
		req.Close = true
		req.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
		req.Header.Set("Accept", "application/json")
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if idemKey != "" {
			req.Header.Set(IdempotencyHeader, idemKey)
		}
		resp, err := s.httpClient().Do(req)
		if err != nil {
			if resp != nil && resp.Body != nil {
				resp.Body.Close()
			}
			cancel()
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if isTimeout(err) && attempt+1 < attemptBudget {
				continue
			}
			if isTimeout(err) {
				return nil, fmt.Errorf("%w: timeout after %d attempts", ErrInfra, attemptBudget)
			}
			return nil, fmt.Errorf("%w: transport", ErrInfra)
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
		resp.Body.Close()
		cancel()
		if readErr != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if isTimeout(readErr) && attempt+1 < attemptBudget {
				continue
			}
			return nil, fmt.Errorf("%w: read", ErrInfra)
		}
		if len(body) > maxBody {
			return nil, fmt.Errorf("%w: response", ErrValidation)
		}
		if resp.StatusCode >= 500 {
			lastStatus = resp.StatusCode
			s.logf("screening %s failed status=%d", method, resp.StatusCode)
			if attempt+1 < attemptBudget {
				continue
			}
			return nil, fmt.Errorf("%w: status %d", ErrInfra, lastStatus)
		}
		if resp.StatusCode == http.StatusUnprocessableEntity {
			return nil, fmt.Errorf("%w: status %d", ErrValidation, resp.StatusCode)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("%w: status %d", ErrRemote, resp.StatusCode)
		}
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
			return nil, fmt.Errorf("%w: status %d", ErrRemote, resp.StatusCode)
		}
		return body, nil
	}
	return nil, fmt.Errorf("%w: status %d", ErrInfra, lastStatus)
}

func (s *Service) httpClient() *http.Client {
	return &http.Client{
		Transport: s.transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errNoRedirect
		},
	}
}

func (s *Service) logf(format string, args ...any) {
	if s.log == nil {
		return
	}
	s.log.Printf(format, args...)
}

var errNoRedirect = fmt.Errorf("%w: redirect", ErrRemote)

func isTimeout(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}
