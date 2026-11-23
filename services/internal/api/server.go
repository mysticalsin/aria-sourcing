// Package api is the HTTP skeleton over the in-memory adapters.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/ledger"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/recruit"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

// Server serves health, campaigns, candidates, and approvals.
type Server struct {
	svc     *recruit.Service
	mode    string
	version string
	token   string
	mux     *http.ServeMux
}

// New wires the routes. mode and version are non-secret enums.
// token is required for every mutating route, including localhost.
func New(svc *recruit.Service, mode, version, token string) *Server {
	s := &Server{svc: svc, mode: mode, version: version, token: token, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("POST /campaigns", s.createCampaign)
	s.mux.HandleFunc("GET /campaigns", s.listCampaigns)
	s.mux.HandleFunc("GET /campaigns/{id}", s.getCampaign)
	s.mux.HandleFunc("POST /candidates", s.createCandidate)
	s.mux.HandleFunc("GET /candidates", s.listCandidates)
	s.mux.HandleFunc("GET /candidates/{id}", s.getCandidate)
	s.mux.HandleFunc("POST /candidates/{id}/transition", s.transition)
	s.mux.HandleFunc("POST /candidates/{id}/contract", s.contract)
	s.mux.HandleFunc("POST /candidates/{id}/touches", s.touch)
	s.mux.HandleFunc("POST /candidates/{id}/opt-out", s.optOut)
	s.mux.HandleFunc("POST /candidates/{id}/erase", s.erase)
	s.mux.HandleFunc("GET /approvals", s.listApprovals)
	s.mux.HandleFunc("POST /approvals", s.createApproval)
	s.mux.HandleFunc("POST /approvals/from-odoo", s.approvalFromOdoo)
	return s
}

// ServeHTTP sets no-store headers and dispatches.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.authorized(r) {
		writeCode(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) authorized(r *http.Request) bool {
	if s.token == "" {
		return false
	}
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	got := header[len(prefix):]
	if len(got) != len(s.token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) == 1
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":       "ok",
		"service":      "aria-services",
		"backend":      "fake",
		"mode":         s.mode,
		"odoo_version": s.version,
	})
}

type campaignRequest struct {
	AriaID         string `json:"aria_id"`
	IdempotencyKey string `json:"idempotency_key"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Openings       int    `json:"openings"`
	ClientName     string `json:"client_name"`
	SmartNeedID    string `json:"smart_need_id"`
}

func (s *Server) createCampaign(w http.ResponseWriter, r *http.Request) {
	var req campaignRequest
	if err := decode(w, r, &req); err != nil {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	job, err := s.svc.CreateCampaign(r.Context(), recruit.CampaignInput{
		AriaID: req.AriaID, IdempotencyKey: req.IdempotencyKey, Name: req.Name,
		Description: req.Description, Openings: req.Openings, ClientName: req.ClientName,
		SmartNeedID: req.SmartNeedID,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, campaignView(job))
}

func (s *Server) listCampaigns(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.svc.Campaigns(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	out := make([]any, 0, len(jobs))
	for _, job := range jobs {
		out = append(out, campaignView(job))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getCampaign(w http.ResponseWriter, r *http.Request) {
	job, err := s.svc.Odoo.ReadJob(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, campaignView(job))
}

type candidateRequest struct {
	AriaID           string `json:"aria_id"`
	IdempotencyKey   string `json:"idempotency_key"`
	Name             string `json:"name"`
	Email            string `json:"email"`
	JobAriaID        string `json:"job_aria_id"`
	Source           string `json:"source"`
	SmartNeedID      string `json:"smart_need_id"`
	SmartCandidateID string `json:"smart_candidate_id"`
	Priority         int    `json:"priority"`
}

func (s *Server) createCandidate(w http.ResponseWriter, r *http.Request) {
	var req candidateRequest
	if err := decode(w, r, &req); err != nil {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	app, err := s.svc.UpsertCandidate(r.Context(), recruit.CandidateInput{
		AriaID: req.AriaID, IdempotencyKey: req.IdempotencyKey, Name: req.Name, Email: req.Email,
		JobAriaID: req.JobAriaID, Source: req.Source, SmartNeedID: req.SmartNeedID,
		SmartCandidateID: req.SmartCandidateID, Priority: req.Priority,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, candidateView(app))
}

func (s *Server) listCandidates(w http.ResponseWriter, r *http.Request) {
	rows, err := s.svc.Applicants(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	out := make([]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, candidateView(row))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getCandidate(w http.ResponseWriter, r *http.Request) {
	app, err := s.svc.Odoo.ReadApplicant(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, candidateView(app))
}

type transitionRequest struct {
	To string `json:"to"`
}

func (s *Server) transition(w http.ResponseWriter, r *http.Request) {
	var req transitionRequest
	if err := decode(w, r, &req); err != nil {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	app, err := s.svc.Transition(r.Context(), r.PathValue("id"), req.To)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, candidateView(app))
}

type contractRequest struct {
	Filename string `json:"filename"`
	SHA256   string `json:"sha256"`
}

func (s *Server) contract(w http.ResponseWriter, r *http.Request) {
	var req contractRequest
	if err := decode(w, r, &req); err != nil {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if _, err := s.svc.AttachContract(r.Context(), r.PathValue("id"), odoo.Contract{
		Filename: req.Filename, SHA256: req.SHA256,
	}); err != nil {
		writeErr(w, err)
		return
	}
	app, err := s.svc.Odoo.ReadApplicant(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, candidateView(app))
}

type touchRequest struct {
	IdempotencyKey string `json:"idempotency_key"`
	Channel        string `json:"channel"`
	Kind           string `json:"kind"`
	Subject        string `json:"subject"`
	Body           string `json:"body"`
	RecipientRef   string `json:"recipient_ref"`
	NoticeVersion  string `json:"notice_version"`
}

func (s *Server) optOut(w http.ResponseWriter, r *http.Request) {
	if err := decode(w, r, &struct{}{}); err != nil && !errors.Is(err, io.EOF) {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	app, err := s.svc.OptOut(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, candidateView(app))
}

func (s *Server) erase(w http.ResponseWriter, r *http.Request) {
	if err := decode(w, r, &struct{}{}); err != nil && !errors.Is(err, io.EOF) {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	app, err := s.svc.Erase(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, candidateView(app))
}

func (s *Server) touch(w http.ResponseWriter, r *http.Request) {
	var req touchRequest
	if err := decode(w, r, &req); err != nil {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	touch, err := s.svc.LogTouch(r.Context(), odoo.Touch{
		IdempotencyKey: req.IdempotencyKey, ApplicantAriaID: r.PathValue("id"),
		Channel: req.Channel, Kind: req.Kind, Subject: req.Subject, Body: req.Body,
		RecipientRef: req.RecipientRef, NoticeVersion: req.NoticeVersion,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"idempotency_key": touch.IdempotencyKey,
		"model":           touch.Model,
		"odoo_id":         touch.OdooID,
	})
}

type approvalRequest struct {
	Channel         string `json:"channel"`
	RecipientRef    string `json:"recipient_ref"`
	Subject         string `json:"subject"`
	Body            string `json:"body"`
	NoticeVersion   string `json:"notice_version"`
	Approver        string `json:"approver"`
	ApplicantAriaID string `json:"applicant_aria_id"`
}

func (s *Server) createApproval(w http.ResponseWriter, r *http.Request) {
	var req approvalRequest
	if err := decode(w, r, &req); err != nil {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	row, err := s.svc.Approve(r.Context(), recruit.ApprovalInput{
		Channel: req.Channel, RecipientRef: req.RecipientRef, Subject: req.Subject, Body: req.Body,
		NoticeVersion: req.NoticeVersion, Approver: req.Approver, ApplicantAriaID: req.ApplicantAriaID,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, approvalView(row))
}

func (s *Server) listApprovals(w http.ResponseWriter, _ *http.Request) {
	rows := s.svc.Approvals()
	out := make([]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, approvalView(row))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) approvalFromOdoo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Note string `json:"note"`
	}
	if err := decode(w, r, &req); err != nil {
		writeCode(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if err := s.svc.GrantFromOdoo(req.Note); err != nil {
		writeErr(w, err)
		return
	}
	writeCode(w, http.StatusForbidden, "odoo_cannot_grant_approval")
}

func campaignView(job odoo.Job) map[string]any {
	return map[string]any{
		"aria_id": job.AriaID, "name": job.Name, "description": job.Description,
		"openings": job.Openings, "smart_need_id": job.SmartNeedID, "odoo_id": job.ID,
		"user_id": job.UserID, "lead_id": job.LeadID,
	}
}

func candidateView(app odoo.Applicant) map[string]any {
	label, _ := stage.Label(app.Stage)
	return map[string]any{
		"aria_id": app.AriaID, "name": app.PartnerName, "email": app.EmailNormalized,
		"stage": app.Stage, "stage_label": label, "source": app.Source,
		"job_aria_id": app.JobAriaID, "smart_need_id": app.SmartNeedID,
		"smart_candidate_id": app.SmartCandidateID, "contract_attached": app.HasContract(),
		"opted_out": app.OptedOut, "erased": app.Erased,
		"odoo_id": app.ID,
	}
}

func approvalView(row ledger.Approval) map[string]any {
	return map[string]any{
		"id": row.ID, "sha256": row.Hash, "approver": row.Approver, "at": row.At.Format(time.RFC3339),
		"channel": row.Channel, "recipient_ref": row.RecipientRef,
		"applicant_aria_id": row.ApplicantAriaID, "granted_by": "aria-ledger",
	}
}

func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("trailing json")
	}
	return nil
}

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, odoo.ErrNotFound):
		writeCode(w, http.StatusNotFound, "not_found")
	case errors.Is(err, odoo.ErrConflict):
		writeCode(w, http.StatusConflict, "conflict")
	case errors.Is(err, recruit.ErrTouchNotApproved):
		writeCode(w, http.StatusForbidden, "touch_not_approved")
	case errors.Is(err, recruit.ErrTouchAfterHired), errors.Is(err, recruit.ErrApplicantClosed):
		writeCode(w, http.StatusConflict, "applicant_closed")
	case errors.Is(err, ledger.ErrOdooCannotGrantApproval):
		writeCode(w, http.StatusForbidden, "odoo_cannot_grant_approval")
	case errors.Is(err, recruit.ErrRecipientNotAllowlisted):
		writeCode(w, http.StatusForbidden, "recipient_not_allowlisted")
	case errors.Is(err, hiregate.ErrHireRefused):
		writeCode(w, http.StatusConflict, "hired_refused")
	case errors.Is(err, odoo.ErrUnsanctionedSource):
		writeCode(w, http.StatusBadRequest, "unsanctioned_source")
	case errors.Is(err, stage.ErrTransition), errors.Is(err, hiregate.ErrHiredRequiresGate):
		writeCode(w, http.StatusBadRequest, "stage_transition_refused")
	default:
		writeCode(w, http.StatusBadRequest, "invalid_request")
	}
}

func writeCode(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
