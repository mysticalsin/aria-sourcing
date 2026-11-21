package odoo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/outbox"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

// Client is the Odoo 19 External JSON-2 adapter.
// Transport is required. The default HTTP client is never used, so constructing
// a client cannot dial by accident. The process refuses live mode, and the
// HTTP server wires the Fake rather than this client.
type Client struct {
	mu         sync.Mutex
	baseURL    string
	db         string
	apiKey     string
	version    string
	http       *http.Client
	audit      *audit.Log
	box        *outbox.Box
	now        func() time.Time
	partners   map[string]Partner
	leads      map[string]Lead
	jobs       map[string]Job
	jobOrder   []string
	people     map[string]Person
	applicants map[string]Applicant
	appOrder   []string
	stages     map[string]int64
	mediumID   int64
}

// ClientConfig configures a JSON-2 client. APIKey is sent only as the bearer
// header and is scrubbed from errors.
type ClientConfig struct {
	BaseURL   string
	DB        string
	APIKey    string
	Version   string
	Transport http.RoundTripper
	Audit     *audit.Log
	Now       func() time.Time
}

// NewClient refuses a missing transport so the default network client cannot be used.
func NewClient(cfg ClientConfig) (*Client, error) {
	if cfg.Transport == nil {
		return nil, errors.New("refusing to dial: json-2 transport is required and the default client is disabled")
	}
	ver, err := NormalizeVersion(cfg.Version)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, errors.New("odoo url is required")
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("odoo api key is required")
	}
	if strings.Contains(cfg.BaseURL, cfg.APIKey) {
		return nil, errors.New("odoo url must not contain the api key")
	}
	if cfg.Audit == nil {
		return nil, verr("audit log is required")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Client{
		baseURL:    strings.TrimRight(cfg.BaseURL, "/"),
		db:         cfg.DB,
		apiKey:     cfg.APIKey,
		version:    ver,
		http:       &http.Client{Transport: cfg.Transport, Timeout: 30 * time.Second, CheckRedirect: refuseRedirect},
		audit:      cfg.Audit,
		box:        outbox.New(),
		now:        cfg.Now,
		partners:   map[string]Partner{},
		leads:      map[string]Lead{},
		jobs:       map[string]Job{},
		people:     map[string]Person{},
		applicants: map[string]Applicant{},
		stages:     map[string]int64{},
	}, nil
}

func refuseRedirect(*http.Request, []*http.Request) error {
	return errors.New("odoo json-2 client refuses redirects")
}

func (c *Client) scrub(err error) error {
	if err == nil || c.apiKey == "" || !strings.Contains(err.Error(), c.apiKey) {
		return err
	}
	return errors.New(strings.ReplaceAll(err.Error(), c.apiKey, "[redacted]"))
}

func (c *Client) call(ctx context.Context, model, method string, args map[string]any, out any) error {
	if args == nil {
		args = map[string]any{}
	}
	payload, err := json.Marshal(args)
	if err != nil {
		return err
	}
	if len(payload) == 0 || payload[0] != '{' {
		return errors.New("json-2 body must be a named-argument object")
	}
	endpoint := c.baseURL + "/json/2/" + model + "/" + method
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return c.scrub(err)
	}
	req.Header.Set("Authorization", "bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.db != "" {
		req.Header.Set("X-Odoo-Database", c.db)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return c.scrub(fmt.Errorf("odoo json-2 %s/%s request failed: %v", model, method, err))
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return c.scrub(fmt.Errorf("odoo json-2 %s/%s read failed", model, method))
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return c.scrub(fmt.Errorf("odoo json-2 %s/%s status %d", model, method, res.StatusCode))
	}
	if out == nil {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(out); err != nil {
		return fmt.Errorf("odoo json-2 %s/%s: bad response", model, method)
	}
	return nil
}

func (c *Client) searchRead(ctx context.Context, model string, domain []any, fields []string, limit int) ([]map[string]any, error) {
	if domain == nil {
		domain = []any{}
	}
	args := map[string]any{"domain": domain, "fields": fields}
	if limit > 0 {
		args["limit"] = limit
	}
	var rows []map[string]any
	if err := c.call(ctx, model, "search_read", args, &rows); err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return rows, nil
}

func (c *Client) createOne(ctx context.Context, model string, vals map[string]any) (int64, error) {
	var ids []int64
	if err := c.call(ctx, model, "create", map[string]any{"vals_list": []any{vals}}, &ids); err != nil {
		return 0, err
	}
	if len(ids) != 1 {
		return 0, fmt.Errorf("odoo json-2 %s/create: expected one id", model)
	}
	return ids[0], nil
}

func (c *Client) write(ctx context.Context, model string, ids []int64, vals map[string]any) error {
	var ok bool
	if err := c.call(ctx, model, "write", map[string]any{"ids": ids, "vals": vals}, &ok); err != nil {
		return err
	}
	return nil
}

func eq(field string, value any) []any { return []any{field, "=", value} }

func and(leaves ...[]any) []any {
	out := make([]any, 0, len(leaves))
	for _, leaf := range leaves {
		out = append(out, leaf)
	}
	return out
}

func asInt64(v any) (int64, error) {
	switch t := v.(type) {
	case json.Number:
		return t.Int64()
	case float64:
		return int64(t), nil
	case int64:
		return t, nil
	case int:
		return int64(t), nil
	default:
		return 0, errors.New("id is not a number")
	}
}

func (c *Client) findXMLID(ctx context.Context, name, model string) (int64, bool, error) {
	rows, err := c.searchRead(ctx, "ir.model.data", and(
		eq("module", "aria"),
		eq("name", name),
		eq("model", model),
	), []string{"res_id"}, 1)
	if err != nil || len(rows) == 0 {
		return 0, false, err
	}
	id, err := asInt64(rows[0]["res_id"])
	if err != nil {
		return 0, false, err
	}
	return id, true, nil
}

func (c *Client) bindXMLID(ctx context.Context, name, model string, resID int64) error {
	if _, ok, err := c.findXMLID(ctx, name, model); err != nil || ok {
		return err
	}
	_, err := c.createOne(ctx, "ir.model.data", map[string]any{
		"module": "aria", "name": name, "model": model, "res_id": resID, "noupdate": true,
	})
	return err
}

func (c *Client) stageID(ctx context.Context, key string) (int64, error) {
	if id, ok := c.stages[key]; ok {
		return id, nil
	}
	if !stage.Known(key) {
		return 0, fmt.Errorf("%w: unknown stage", stage.ErrTransition)
	}
	rows, err := c.searchRead(ctx, "hr.recruitment.stage", and(eq("name", key)), []string{"id"}, 1)
	if err != nil {
		return 0, err
	}
	var id int64
	if len(rows) == 1 {
		id, err = asInt64(rows[0]["id"])
		if err != nil {
			return 0, err
		}
	} else {
		seq, _ := stage.Sequence(key)
		id, err = c.createOne(ctx, "hr.recruitment.stage", map[string]any{"name": key, "sequence": seq})
		if err != nil {
			return 0, err
		}
	}
	c.stages[key] = id
	return id, nil
}

func (c *Client) ensureMedium(ctx context.Context) (int64, error) {
	if c.mediumID != 0 {
		return c.mediumID, nil
	}
	rows, err := c.searchRead(ctx, "utm.medium", and(eq("name", "aria")), []string{"id"}, 1)
	if err != nil {
		return 0, err
	}
	if len(rows) == 1 {
		c.mediumID, err = asInt64(rows[0]["id"])
		return c.mediumID, err
	}
	c.mediumID, err = c.createOne(ctx, "utm.medium", map[string]any{"name": "aria"})
	return c.mediumID, err
}

func (c *Client) ensureSource(ctx context.Context, jobID int64, name string) (int64, error) {
	canonical, err := CanonicalSource(name)
	if err != nil {
		return 0, err
	}
	rows, err := c.searchRead(ctx, "utm.source", and(eq("name", canonical)), []string{"id"}, 1)
	if err != nil {
		return 0, err
	}
	var id int64
	if len(rows) == 1 {
		id, err = asInt64(rows[0]["id"])
		if err != nil {
			return 0, err
		}
	} else {
		id, err = c.createOne(ctx, "utm.source", map[string]any{"name": canonical})
		if err != nil {
			return 0, err
		}
	}
	rec, err := c.searchRead(ctx, "hr.recruitment.source", and(
		eq("source_id", id),
		eq("job_id", jobID),
	), []string{"id"}, 1)
	if err != nil {
		return 0, err
	}
	if len(rec) == 0 {
		if _, err := c.createOne(ctx, "hr.recruitment.source", map[string]any{"source_id": id, "job_id": jobID}); err != nil {
			return 0, err
		}
	}
	return id, nil
}

// UpsertPartner writes res.partner through JSON-2.
func (c *Client) UpsertPartner(ctx context.Context, in Partner) (Partner, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Partner{}, err
	}
	if err := validatePartner(in); err != nil {
		return Partner{}, err
	}
	name, _ := cleanName(in.Name)
	email, _ := optionalEmail(in.Email)
	in.Name, in.Email = name, email
	var cached Partner
	if ok, err := c.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	if row, ok := c.partners[in.AriaID]; ok {
		return row, nil
	}
	vals := map[string]any{"name": in.Name, "is_company": in.IsCompany}
	if email != "" {
		vals["email"] = email
	}
	id, err := c.createOne(ctx, "res.partner", vals)
	if err != nil {
		return Partner{}, err
	}
	in.ID = id
	if err := c.bindXMLID(ctx, "partner_"+in.AriaID, "res.partner", id); err != nil {
		return Partner{}, err
	}
	c.partners[in.AriaID] = in
	_ = c.box.Store(in.IdempotencyKey, in)
	return in, nil
}

// UpsertLead writes crm.lead type opportunity.
func (c *Client) UpsertLead(ctx context.Context, in Lead) (Lead, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Lead{}, err
	}
	if err := validateLead(in); err != nil {
		return Lead{}, err
	}
	name, _ := cleanName(in.Name)
	in.Name = name
	in.Type = "opportunity"
	var cached Lead
	if ok, err := c.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	if in.PartnerAriaID != "" {
		p, ok := c.partners[in.PartnerAriaID]
		if !ok {
			return Lead{}, ErrNotFound
		}
		in.PartnerID = p.ID
	}
	id, err := c.createOne(ctx, "crm.lead", map[string]any{
		"name": in.Name, "partner_id": in.PartnerID, "type": "opportunity",
	})
	if err != nil {
		return Lead{}, err
	}
	in.ID = id
	c.leads[in.AriaID] = in
	_ = c.box.Store(in.IdempotencyKey, in)
	return in, nil
}

// UpsertJob writes hr.job.
func (c *Client) UpsertJob(ctx context.Context, in Job) (Job, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Job{}, err
	}
	if err := validateJob(in); err != nil {
		return Job{}, err
	}
	name, _ := cleanName(in.Name)
	in.Name = name
	if in.Openings == 0 {
		in.Openings = 1
	}
	var cached Job
	if ok, err := c.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	if row, ok := c.jobs[in.AriaID]; ok {
		return row, nil
	}
	id, err := c.createOne(ctx, "hr.job", map[string]any{
		"name": in.Name, "description": in.Description, "no_of_recruitment": in.Openings,
	})
	if err != nil {
		return Job{}, err
	}
	in.ID = id
	if err := c.bindXMLID(ctx, "job_"+in.AriaID, "hr.job", id); err != nil {
		return Job{}, err
	}
	if in.SmartNeedID != "" {
		if err := c.bindXMLID(ctx, "smart_need_"+in.SmartNeedID, "hr.job", id); err != nil {
			return Job{}, err
		}
	}
	_, _ = c.createOne(ctx, "utm.campaign", map[string]any{"name": in.Name})
	c.jobs[in.AriaID] = in
	c.jobOrder = append(c.jobOrder, in.AriaID)
	_ = c.box.Store(in.IdempotencyKey, in)
	return in, nil
}

// UpsertPerson hides hr.candidate (Odoo 18) and the talent-pool hr.applicant (Odoo 19).
func (c *Client) UpsertPerson(ctx context.Context, in Person) (Person, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Person{}, err
	}
	if err := validatePerson(in); err != nil {
		return Person{}, err
	}
	name, _ := cleanName(in.Name)
	email, _ := requiredEmail(in.Email)
	in.Name, in.Email, in.EmailNormalized = name, email, email
	var cached Person
	if ok, err := c.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	if row, ok := c.people[in.AriaID]; ok {
		return row, nil
	}
	partner, err := c.upsertPartnerLocked(ctx, Partner{
		AriaID: "person-" + in.AriaID, IdempotencyKey: in.IdempotencyKey + "-partner",
		Name: name, Email: email,
	})
	if err != nil {
		return Person{}, err
	}
	model := PersonRecordModel(c.version)
	vals := map[string]any{
		"partner_name": name, "email_from": email, "partner_id": partner.ID,
	}
	if in.LinkedInProfile != "" {
		vals["linkedin_profile"] = in.LinkedInProfile
	}
	id, err := c.createOne(ctx, model, vals)
	if err != nil {
		return Person{}, err
	}
	if err := c.bindXMLID(ctx, "person_"+in.AriaID, model, id); err != nil {
		return Person{}, err
	}
	in.ID = id
	in.PartnerID = partner.ID
	c.people[in.AriaID] = in
	_ = c.box.Store(in.IdempotencyKey, in)
	return in, nil
}

func (c *Client) resolveJob(ctx context.Context, ariaID string) (Job, error) {
	if row, ok := c.jobs[ariaID]; ok && row.ID != 0 {
		return row, nil
	}
	resID, found, err := c.findXMLID(ctx, "job_"+ariaID, "hr.job")
	if err != nil {
		return Job{}, err
	}
	if !found {
		return Job{}, ErrNotFound
	}
	row := Job{ID: resID, AriaID: ariaID}
	c.jobs[ariaID] = row
	return row, nil
}

func (c *Client) partnerByEmail(ctx context.Context, name, email, ariaID string) (Partner, error) {
	if row, ok := c.partners[ariaID]; ok && row.ID != 0 {
		return row, nil
	}
	rows, err := c.searchRead(ctx, "res.partner", and(eq("email", email)), []string{"id", "name"}, 1)
	if err != nil {
		return Partner{}, err
	}
	if len(rows) == 1 {
		id, err := asInt64(rows[0]["id"])
		if err != nil {
			return Partner{}, err
		}
		row := Partner{ID: id, AriaID: ariaID, Name: name, Email: email}
		c.partners[ariaID] = row
		return row, nil
	}
	return c.upsertPartnerLocked(ctx, Partner{AriaID: ariaID, Name: name, Email: email})
}

func (c *Client) upsertPartnerLocked(ctx context.Context, in Partner) (Partner, error) {
	if row, ok := c.partners[in.AriaID]; ok {
		return row, nil
	}
	vals := map[string]any{"name": in.Name, "is_company": in.IsCompany}
	if in.Email != "" {
		vals["email"] = in.Email
	}
	id, err := c.createOne(ctx, "res.partner", vals)
	if err != nil {
		return Partner{}, err
	}
	in.ID = id
	c.partners[in.AriaID] = in
	return in, nil
}

// UpsertApplicant searches ir.model.data and (email_normalized, job_id) before creating.
func (c *Client) UpsertApplicant(ctx context.Context, in Applicant) (Applicant, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	if err := validateApplicant(in); err != nil {
		return Applicant{}, err
	}
	name, _ := cleanName(in.PartnerName)
	email, _ := requiredEmail(in.EmailFrom)
	in.PartnerName, in.EmailFrom, in.EmailNormalized = name, email, email
	var cached Applicant
	if ok, err := c.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	job, err := c.resolveJob(ctx, in.JobAriaID)
	if err != nil {
		return Applicant{}, err
	}
	sourceID, err := c.ensureSource(ctx, job.ID, in.Source)
	if err != nil {
		return Applicant{}, err
	}
	mediumID, err := c.ensureMedium(ctx)
	if err != nil {
		return Applicant{}, err
	}
	stageID, err := c.stageID(ctx, stage.ToRate)
	if err != nil {
		return Applicant{}, err
	}
	partner, err := c.partnerByEmail(ctx, name, email, "applicant-partner-"+in.AriaID)
	if err != nil {
		return Applicant{}, err
	}
	in.PartnerID = partner.ID
	if resID, found, err := c.findXMLID(ctx, "applicant_"+in.AriaID, "hr.applicant"); err != nil {
		return Applicant{}, err
	} else if found {
		return c.cacheApplicant(ctx, in, resID, job, sourceID, mediumID, false)
	}
	rows, err := c.searchRead(ctx, "hr.applicant", and(
		eq("email_normalized", email),
		eq("job_id", job.ID),
	), []string{"id"}, 2)
	if err != nil {
		return Applicant{}, err
	}
	if len(rows) > 1 {
		return Applicant{}, ErrConflict
	}
	if len(rows) == 1 {
		resID, err := asInt64(rows[0]["id"])
		if err != nil {
			return Applicant{}, err
		}
		return c.cacheApplicant(ctx, in, resID, job, sourceID, mediumID, true)
	}
	id, err := c.createOne(ctx, "hr.applicant", map[string]any{
		"partner_name": name,
		"email_from":   email,
		"partner_id":   partner.ID,
		"job_id":       job.ID,
		"stage_id":     stageID,
		"source_id":    sourceID,
		"medium_id":    mediumID,
		"priority":     in.Priority,
	})
	if err != nil {
		return Applicant{}, err
	}
	return c.cacheApplicant(ctx, in, id, job, sourceID, mediumID, false)
}

func (c *Client) cacheApplicant(ctx context.Context, in Applicant, resID int64, job Job, sourceID, mediumID int64, update bool) (Applicant, error) {
	if update {
		if err := c.write(ctx, "hr.applicant", []int64{resID}, map[string]any{
			"partner_name": in.PartnerName,
			"email_from":   in.EmailFrom,
			"source_id":    sourceID,
			"priority":     in.Priority,
		}); err != nil {
			return Applicant{}, err
		}
	}
	if err := c.bindXMLID(ctx, "applicant_"+in.AriaID, "hr.applicant", resID); err != nil {
		return Applicant{}, err
	}
	if in.SmartCandidateID != "" && in.PartnerID != 0 {
		if err := c.bindXMLID(ctx, "smart_candidate_"+in.SmartCandidateID, "res.partner", in.PartnerID); err != nil {
			return Applicant{}, err
		}
	}
	in.ID = resID
	in.JobID = job.ID
	in.SourceID = sourceID
	in.MediumID = mediumID
	if prev, ok := c.applicants[in.AriaID]; ok && prev.Stage != "" {
		in.Stage = prev.Stage
		in.StageID = prev.StageID
		in.Contract = prev.Contract
	} else if in.Stage == "" {
		in.Stage = stage.ToRate
		in.StageID = c.stages[stage.ToRate]
	}
	if _, ok := c.applicants[in.AriaID]; !ok {
		c.appOrder = append(c.appOrder, in.AriaID)
	}
	c.applicants[in.AriaID] = in
	_ = c.box.Store(in.IdempotencyKey, in)
	return in, nil
}

// ReadApplicant returns the applicant cached by this client.
func (c *Client) ReadApplicant(ctx context.Context, ariaID string) (Applicant, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	row, ok := c.applicants[ariaID]
	if !ok {
		return Applicant{}, ErrNotFound
	}
	return row, nil
}

// ReadJob returns the job cached by this client.
func (c *Client) ReadJob(ctx context.Context, ariaID string) (Job, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Job{}, err
	}
	row, ok := c.jobs[ariaID]
	if !ok {
		return Job{}, ErrNotFound
	}
	return row, nil
}

// ListApplicants returns applicants cached by this client.
func (c *Client) ListApplicants(ctx context.Context) ([]Applicant, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	out := make([]Applicant, 0, len(c.appOrder))
	for _, id := range c.appOrder {
		out = append(out, c.applicants[id])
	}
	return out, nil
}

// ListJobs returns jobs cached by this client.
func (c *Client) ListJobs(ctx context.Context) ([]Job, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	out := make([]Job, 0, len(c.jobOrder))
	for _, id := range c.jobOrder {
		out = append(out, c.jobs[id])
	}
	return out, nil
}

// LogTouch posts mail.message or creates mail.activity, plus one audit row.
func (c *Client) LogTouch(ctx context.Context, in Touch) (Touch, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Touch{}, err
	}
	if err := validateTouch(in); err != nil {
		return Touch{}, err
	}
	var cached Touch
	if ok, err := c.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	app, ok := c.applicants[in.ApplicantAriaID]
	if !ok {
		return Touch{}, ErrNotFound
	}
	var id int64
	var model string
	var err error
	switch in.Kind {
	case "message":
		model = "mail.message"
		id, err = c.postMessage(ctx, app.ID, in.Body, "mail.mt_comment")
	default:
		model = "mail.activity"
		id, err = c.createOne(ctx, "mail.activity", map[string]any{
			"res_model": "hr.applicant", "res_id": app.ID, "summary": in.Subject, "note": in.Body,
		})
	}
	if err != nil {
		return Touch{}, err
	}
	in.OdooID = id
	in.Model = model
	if _, err := c.audit.Append(audit.Entry{
		Action: audit.ActionTouch, IdempotencyKey: in.IdempotencyKey,
		AriaID: in.ApplicantAriaID, Model: model,
		Detail: "channel=" + in.Channel + ";kind=" + in.Kind,
	}); err != nil {
		return Touch{}, err
	}
	_ = c.box.Store(in.IdempotencyKey, in)
	return in, nil
}

func (c *Client) postMessage(ctx context.Context, resID int64, body, subtype string) (int64, error) {
	var id int64
	err := c.call(ctx, "hr.applicant", "message_post", map[string]any{
		"ids": []int64{resID}, "body": body, "message_type": "comment", "subtype_xmlid": subtype,
	}, &id)
	return id, err
}

// PostInternalNote mirrors a fact. The stored subtype is the internal note.
func (c *Client) PostInternalNote(ctx context.Context, in Note) (Note, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Note{}, err
	}
	if strings.TrimSpace(in.Body) == "" || in.ApplicantAriaID == "" || in.IdempotencyKey == "" {
		return Note{}, verr("internal note is incomplete")
	}
	var cached Note
	if ok, err := c.box.Load(in.IdempotencyKey, &cached); err != nil || ok {
		return cached, err
	}
	app, ok := c.applicants[in.ApplicantAriaID]
	if !ok {
		return Note{}, ErrNotFound
	}
	id, err := c.postMessage(ctx, app.ID, in.Body, "mail.mt_note")
	if err != nil {
		return Note{}, err
	}
	in.OdooID = id
	_ = c.box.Store(in.IdempotencyKey, in)
	return in, nil
}

// AttachContract creates an ir.attachment reference without file bytes.
func (c *Client) AttachContract(ctx context.Context, ariaID string, contract Contract) (Contract, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Contract{}, err
	}
	if err := validateContract(contract); err != nil {
		return Contract{}, err
	}
	app, ok := c.applicants[ariaID]
	if !ok {
		return Contract{}, ErrNotFound
	}
	if app.Contract != nil && app.Contract.SHA256 == contract.SHA256 && app.Contract.Filename == contract.Filename {
		return *app.Contract, nil
	}
	id, err := c.createOne(ctx, "ir.attachment", map[string]any{
		"name": contract.Filename, "res_model": "hr.applicant", "res_id": app.ID, "checksum": contract.SHA256,
	})
	if err != nil {
		return Contract{}, err
	}
	contract.ID = id
	contract.ResModel = "hr.applicant"
	contract.ResID = app.ID
	app.Contract = &contract
	c.applicants[ariaID] = app
	return contract, nil
}

// TransitionStage writes stage_id. hired is refused.
func (c *Client) TransitionStage(ctx context.Context, ariaID, to string) (Applicant, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	if to == stage.Hired {
		return Applicant{}, hiregate.ErrHiredRequiresGate
	}
	app, ok := c.applicants[ariaID]
	if !ok {
		return Applicant{}, ErrNotFound
	}
	if err := stage.Allow(app.Stage, to); err != nil {
		return Applicant{}, err
	}
	sid, err := c.stageID(ctx, to)
	if err != nil {
		return Applicant{}, err
	}
	if err := c.write(ctx, "hr.applicant", []int64{app.ID}, map[string]any{"stage_id": sid}); err != nil {
		return Applicant{}, err
	}
	app.Stage = to
	app.StageID = sid
	c.applicants[ariaID] = app
	return app, nil
}

// MarkHired writes the hired stage only when the clearance matches and a contract is attached.
func (c *Client) MarkHired(ctx context.Context, ariaID string, clearance hiregate.Clearance) (Applicant, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Applicant{}, err
	}
	if !clearance.ValidFor(ariaID) {
		return Applicant{}, hiregate.ErrHireRefused
	}
	app, ok := c.applicants[ariaID]
	if !ok {
		return Applicant{}, ErrNotFound
	}
	if err := stage.Allow(app.Stage, stage.Hired); err != nil {
		return Applicant{}, err
	}
	var parts []error
	if !app.HasContract() {
		parts = append(parts, hiregate.ErrContractNotAttached)
	}
	if clearance.CandidateID() != app.SmartCandidateID || clearance.NeedID() != app.SmartNeedID || app.SmartCandidateID == "" {
		parts = append(parts, hiregate.ErrDNANotIntegrated)
	}
	if len(parts) > 0 {
		return Applicant{}, errors.Join(append([]error{hiregate.ErrHireRefused}, parts...)...)
	}
	sid, err := c.stageID(ctx, stage.Hired)
	if err != nil {
		return Applicant{}, err
	}
	if err := c.write(ctx, "hr.applicant", []int64{app.ID}, map[string]any{"stage_id": sid}); err != nil {
		return Applicant{}, err
	}
	app.Stage = stage.Hired
	app.StageID = sid
	c.applicants[ariaID] = app
	_, _ = c.audit.Append(audit.Entry{
		Action: audit.ActionHired, IdempotencyKey: "stage.hired." + ariaID,
		AriaID: ariaID, Model: "hr.applicant", Detail: "hired",
	})
	return app, nil
}

var (
	_ Port = (*Fake)(nil)
	_ Port = (*Client)(nil)
)
