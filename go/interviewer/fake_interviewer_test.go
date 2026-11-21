package interviewer_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// fakeInterviewer is an in-process stand-in for Tony's interviewer.
// Tests never dial a real host and never load a real API key.
type fakeInterviewer struct {
	t      *testing.T
	srv    *httptest.Server
	apiKey string

	mu           sync.Mutex
	hits         int
	postHits     int
	getHits      int
	creates      int
	records      map[string]*storedScreening
	byID         map[string]*storedScreening
	seq          int
	hangPOST     bool
	hangGET      bool
	forceStatus  int
	redirect     bool
	createStatus string
	createExtra  map[string]any
	lastBody     []byte
	lastHeader   http.Header
}

type storedScreening struct {
	id      string
	status  string
	logical string
	extra   map[string]any
}

func newFake(t *testing.T, apiKey string) *fakeInterviewer {
	t.Helper()
	f := &fakeInterviewer{
		t:            t,
		apiKey:       apiKey,
		records:      map[string]*storedScreening{},
		byID:         map[string]*storedScreening{},
		createStatus: "requested",
	}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeInterviewer) url() string { return f.srv.URL }

func (f *fakeInterviewer) hits() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits
}

func (f *fakeInterviewer) creates() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.creates
}

func (f *fakeInterviewer) postHits() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.postHits
}

func (f *fakeInterviewer) getHits() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.getHits
}

func (f *fakeInterviewer) lastPost() ([]byte, http.Header) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]byte(nil), f.lastBody...), f.lastHeader.Clone()
}

func (f *fakeInterviewer) setStatus(id, status string, extra map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.byID[id]
	if !ok {
		f.t.Fatalf("no screening %s", id)
	}
	rec.status = status
	if extra != nil {
		rec.extra = extra
	}
}

func (f *fakeInterviewer) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.hits++
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/screenings":
		f.postHits++
	case r.Method == http.MethodGet && len(r.URL.Path) > len("/v1/screenings/"):
		f.getHits++
	}
	hangPOST := f.hangPOST
	hangGET := f.hangGET
	force := f.forceStatus
	redirect := f.redirect
	f.mu.Unlock()

	if redirect && r.URL.Path == "/v1/screenings" {
		w.Header().Set("Location", f.srv.URL+"/v1/stolen")
		w.WriteHeader(http.StatusFound)
		return
	}
	if r.URL.Path == "/v1/stolen" {
		f.t.Errorf("client followed a redirect")
		http.NotFound(w, r)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+f.apiKey {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if force != 0 {
		http.Error(w, "forced", force)
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/screenings":
		if hangPOST {
			<-r.Context().Done()
			return
		}
		f.create(w, r)
	case r.Method == http.MethodGet && len(r.URL.Path) > len("/v1/screenings/"):
		if hangGET {
			<-r.Context().Done()
			return
		}
		f.poll(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeInterviewer) create(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		http.Error(w, "missing idempotency key", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "body", http.StatusBadRequest)
		return
	}
	var payload struct {
		NeedSummary   string   `json:"need_summary"`
		RoleQuestions []string `json:"role_questions"`
		CandidateID   string   `json:"candidate_id"`
		Language      string   `json:"language"`
		Consent       *bool    `json:"consent"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Consent == nil || !*payload.Consent {
		http.Error(w, "consent required", http.StatusUnprocessableEntity)
		return
	}
	logical := payload.CandidateID + "|" + payload.NeedSummary + "|" + payload.Language
	for _, q := range payload.RoleQuestions {
		logical += "|" + q
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastBody = append([]byte(nil), body...)
	f.lastHeader = r.Header.Clone()
	if existing, ok := f.records[key]; ok {
		if existing.logical != logical {
			http.Error(w, "idempotency conflict", http.StatusConflict)
			return
		}
		writeJSON(w, http.StatusAccepted, existing.public())
		return
	}
	f.seq++
	rec := &storedScreening{
		id:      "scr-synthetic-" + itoa(f.seq),
		status:  f.createStatus,
		logical: logical,
		extra:   cloneMap(f.createExtra),
	}
	f.records[key] = rec
	f.byID[rec.id] = rec
	f.creates++
	writeJSON(w, http.StatusAccepted, rec.public())
}

func (f *fakeInterviewer) poll(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[len("/v1/screenings/"):]
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.byID[id]
	if !ok {
		http.Error(w, "missing", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, rec.public())
}

func (s *storedScreening) public() map[string]any {
	out := map[string]any{"id": s.id, "status": s.status}
	for k, v := range s.extra {
		out[k] = v
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
