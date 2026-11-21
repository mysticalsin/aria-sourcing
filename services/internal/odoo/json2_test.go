package odoo_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/audit"
	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
)

type memRPC struct {
	mu      sync.Mutex
	next    int64
	rows    map[string][]map[string]string
	creates map[string]int
	paths   []string
}

func newMemRPC() *memRPC {
	return &memRPC{rows: map[string][]map[string]string{}, creates: map[string]int{}}
}

func (m *memRPC) CreateCount(model string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.creates[model]
}

func (m *memRPC) Paths() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]string(nil), m.paths...)
	return out
}

func (m *memRPC) RoundTrip(req *http.Request) (*http.Response, error) {
	if !strings.HasPrefix(req.Header.Get("Authorization"), "bearer ") || strings.TrimPrefix(req.Header.Get("Authorization"), "bearer ") == "" {
		return jsonResponse(401, map[string]string{"message": "auth"}), nil
	}
	if req.Header.Get("Content-Type") != "application/json" {
		return jsonResponse(415, map[string]string{"message": "type"}), nil
	}
	raw, err := io.ReadAll(io.LimitReader(req.Body, 1<<20))
	if err != nil || len(raw) == 0 || raw[0] != '{' {
		return jsonResponse(400, map[string]string{"message": "body"}), nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var args map[string]any
	if err := dec.Decode(&args); err != nil {
		return jsonResponse(400, map[string]string{"message": "body"}), nil
	}
	parts := strings.Split(strings.Trim(req.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "json" || parts[1] != "2" {
		return jsonResponse(404, map[string]string{"message": "path"}), nil
	}
	model, method := parts[2], parts[3]
	m.mu.Lock()
	defer m.mu.Unlock()
	m.paths = append(m.paths, req.URL.Path)
	switch method {
	case "search_read":
		return jsonResponse(200, m.search(model, args)), nil
	case "create":
		return jsonResponse(200, m.create(model, args)), nil
	case "write":
		m.write(model, args)
		return jsonResponse(200, true), nil
	case "message_post":
		return jsonResponse(200, m.message(args)), nil
	default:
		return jsonResponse(404, map[string]string{"message": "method"}), nil
	}
}

func (m *memRPC) search(model string, args map[string]any) []map[string]any {
	fields := stringList(args["fields"])
	limit := intFrom(args["limit"])
	var out []map[string]any
	for _, rec := range m.rows[model] {
		if matchDomain(rec, args["domain"]) {
			out = append(out, project(rec, fields))
			if limit > 0 && len(out) >= limit {
				break
			}
		}
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

func (m *memRPC) create(model string, args map[string]any) []int64 {
	list, _ := args["vals_list"].([]any)
	var ids []int64
	for _, item := range list {
		vals, _ := item.(map[string]any)
		m.next++
		rec := map[string]string{"id": strconv.FormatInt(m.next, 10)}
		for k, v := range vals {
			rec[k] = canon(v)
		}
		if model == "hr.applicant" && rec["email_normalized"] == "" && rec["email_from"] != "" {
			rec["email_normalized"] = strings.ToLower(strings.TrimSpace(rec["email_from"]))
		}
		m.rows[model] = append(m.rows[model], rec)
		m.creates[model]++
		ids = append(ids, m.next)
	}
	return ids
}

func (m *memRPC) write(model string, args map[string]any) {
	ids := intList(args["ids"])
	vals, _ := args["vals"].(map[string]any)
	want := map[string]bool{}
	for _, id := range ids {
		want[strconv.FormatInt(id, 10)] = true
	}
	for _, rec := range m.rows[model] {
		if want[rec["id"]] {
			for k, v := range vals {
				rec[k] = canon(v)
			}
		}
	}
}

func (m *memRPC) message(args map[string]any) int64 {
	m.next++
	rec := map[string]string{
		"id":              strconv.FormatInt(m.next, 10),
		"body":            canon(args["body"]),
		"subtype_xmlid":   canon(args["subtype_xmlid"]),
		"message_type":    canon(args["message_type"]),
		"grants_approval": "false",
	}
	m.rows["mail.message"] = append(m.rows["mail.message"], rec)
	m.creates["mail.message"]++
	return m.next
}

func matchDomain(rec map[string]string, domain any) bool {
	leaves, _ := domain.([]any)
	for _, leaf := range leaves {
		parts, _ := leaf.([]any)
		if len(parts) != 3 || canon(parts[1]) != "=" {
			return false
		}
		if rec[canon(parts[0])] != canon(parts[2]) {
			return false
		}
	}
	return true
}

func project(rec map[string]string, fields []string) map[string]any {
	out := map[string]any{}
	keep := map[string]bool{}
	for _, field := range fields {
		keep[field] = true
	}
	for k, v := range rec {
		if len(keep) > 0 && !keep[k] {
			continue
		}
		if numericField(k) {
			out[k] = json.Number(v)
			continue
		}
		out[k] = v
	}
	return out
}

func numericField(name string) bool {
	return name == "id" || strings.HasSuffix(name, "_id") || name == "priority" || name == "sequence" || name == "no_of_recruitment"
}

func canon(v any) string {
	switch t := v.(type) {
	case json.Number:
		return t.String()
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case nil:
		return ""
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

func stringList(v any) []string {
	items, _ := v.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, canon(item))
	}
	return out
}

func intList(v any) []int64 {
	items, _ := v.([]any)
	var out []int64
	for _, item := range items {
		n, _ := strconv.ParseInt(canon(item), 10, 64)
		out = append(out, n)
	}
	return out
}

func intFrom(v any) int {
	n, _ := strconv.Atoi(canon(v))
	return n
}

func jsonResponse(status int, body any) *http.Response {
	raw, _ := json.Marshal(body)
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(bytes.NewReader(raw)),
	}
}

func testClient(t *testing.T, version, db string, rt http.RoundTripper) *odoo.Client {
	t.Helper()
	c, err := odoo.NewClient(odoo.ClientConfig{
		BaseURL: "http://odoo.invalid", DB: db, APIKey: "canary-not-a-credential",
		Version: version, Transport: rt, Audit: audit.New(fixedNow), Now: fixedNow,
	})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestJSON2RequestShapeNeverDialsOrLeaksTheKey(t *testing.T) {
	const key = "canary-not-a-credential"
	var seen *http.Request
	rt := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		seen = r
		if strings.Contains(r.URL.String(), key) {
			t.Errorf("api key in url %s", r.URL)
		}
		return jsonResponse(200, []int64{}), nil
	})
	c := testClient(t, "19", "synthetic", rt)
	_, err := c.UpsertJob(context.Background(), odoo.Job{
		AriaID: "job-1", IdempotencyKey: "job-1", Name: "Synthetic role",
	})
	if err != nil && seen == nil {
		t.Fatal(err)
	}
	if seen == nil {
		t.Fatal("no request")
	}
	if seen.Method != http.MethodPost || !strings.Contains(seen.URL.Path, "/json/2/") {
		t.Fatalf("request = %s %s", seen.Method, seen.URL)
	}
	if seen.Header.Get("Authorization") != "bearer "+key {
		t.Fatalf("authorization = %q", seen.Header.Get("Authorization"))
	}
	if seen.Header.Get("X-Odoo-Database") != "synthetic" {
		t.Fatalf("database header = %q", seen.Header.Get("X-Odoo-Database"))
	}
	body, _ := io.ReadAll(seen.Body)
	if len(body) == 0 || body[0] != '{' {
		t.Fatalf("body = %s", body)
	}

	bare := testClient(t, "19", "", roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("X-Odoo-Database") != "" {
			t.Errorf("database header set to %q", r.Header.Get("X-Odoo-Database"))
		}
		return nil, errors.New("dial failed " + r.Header.Get("Authorization"))
	}))
	_, err = bare.UpsertJob(context.Background(), odoo.Job{AriaID: "job-2", IdempotencyKey: "job-2", Name: "Synthetic role"})
	if err == nil || strings.Contains(err.Error(), key) {
		t.Fatalf("error = %v", err)
	}
	if _, err := odoo.NewClient(odoo.ClientConfig{BaseURL: "http://odoo.invalid", APIKey: key, Audit: audit.New(nil)}); err == nil {
		t.Fatal("nil transport was accepted")
	}
}

func TestJSON2UpsertApplicantReplayDoesNotCreate(t *testing.T) {
	ctx := context.Background()
	rpc := newMemRPC()
	c := testClient(t, "19", "", rpc)
	if _, err := c.UpsertJob(ctx, odoo.Job{AriaID: "job-1", IdempotencyKey: "job-1", Name: "Synthetic role", SmartNeedID: "need-1001"}); err != nil {
		t.Fatal(err)
	}
	in := applicantInput()
	if _, err := c.UpsertApplicant(ctx, in); err != nil {
		t.Fatal(err)
	}
	if _, err := c.UpsertApplicant(ctx, in); err != nil {
		t.Fatal(err)
	}
	if rpc.CreateCount("hr.applicant") != 1 {
		t.Fatalf("creates = %d paths=%v", rpc.CreateCount("hr.applicant"), rpc.Paths())
	}
	restarted := testClient(t, "19", "", rpc)
	if _, err := restarted.UpsertApplicant(ctx, in); err != nil {
		t.Fatal(err)
	}
	other := in
	other.AriaID = "cand-2"
	other.IdempotencyKey = "idem-c"
	if _, err := restarted.UpsertApplicant(ctx, other); err != nil {
		t.Fatal(err)
	}
	if rpc.CreateCount("hr.applicant") != 1 {
		t.Fatalf("replay created another applicant: %d", rpc.CreateCount("hr.applicant"))
	}
}

func TestJSON2PersonModelFollowsVersion(t *testing.T) {
	ctx := context.Background()
	person := odoo.Person{AriaID: "person-1", IdempotencyKey: "person-1", Name: "Mina Ortega", Email: "mina.ortega@people.example.test"}
	for _, tc := range []struct {
		version string
		want    string
		forbid  string
	}{
		{version: "18", want: "/json/2/hr.candidate/", forbid: "/json/2/hr.applicant/"},
		{version: "19", want: "/json/2/hr.applicant/", forbid: "/json/2/hr.candidate/"},
	} {
		t.Run(tc.version, func(t *testing.T) {
			rpc := newMemRPC()
			c := testClient(t, tc.version, "", rpc)
			if _, err := c.UpsertPerson(ctx, person); err != nil {
				t.Fatal(err)
			}
			var sawWant, sawForbid bool
			for _, path := range rpc.Paths() {
				if strings.Contains(path, tc.want) {
					sawWant = true
				}
				if strings.Contains(path, tc.forbid) {
					sawForbid = true
				}
			}
			if !sawWant || sawForbid {
				t.Fatalf("paths = %v", rpc.Paths())
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
