// Package aria calls the Rust core in-process through the stable C ABI in
// core/include/aria_core.h. Build the static library first:
//
//	cargo build --release --manifest-path core/Cargo.toml -p aria-ffi
package aria

/*
#cgo CFLAGS: -I${SRCDIR}/../../include
#cgo LDFLAGS: ${SRCDIR}/../../target/release/libaria_core.a -ldl -lm -lpthread
#include "aria_core.h"
#include <stdlib.h>
*/
import "C"
import (
	"fmt"
	"unsafe"
)

// StageKeys are Aria's Odoo stage ids, in index order.
func StageKeys() ([]string, error) {
	count := int(C.aria_stage_count())
	keys := make([]string, 0, count)
	for i := 0; i < count; i++ {
		buf := make([]byte, 64)
		rc := C.aria_stage_key(C.uint32_t(i), (*C.char)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)))
		if err := status(rc); err != nil {
			return nil, err
		}
		keys = append(keys, cString(buf))
	}
	return keys, nil
}

// Candidate is the scoring input. A nil Years means the value is unknown.
type Candidate struct {
	TechStack      []string
	Years          *float64
	CompanyStages  []string
	Industries     []string
	Location       string
	Timezone       string
	RecentActivity string
}

// Job is the role the candidate is scored against.
type Job struct {
	LocationType     string
	Location         string
	Regions          []string
	Timezone         string
	RequiredSkills   []string
	NiceToHaveSkills []string
	MinYears         *float64
	MaxYears         *float64
	CompanyStages    []string
	Industries       []string
}

// Weights overrides the default six weights. Nil uses the TypeScript defaults.
type Weights struct {
	Skills       float64
	Experience   float64
	CompanyStage float64
	Industry     float64
	Location     float64
	Activity     float64
}

// Score is one suggestion. SuggestionOnly is always true.
type Score struct {
	Score          float64        `json:"score"`
	SuggestionOnly bool           `json:"suggestionOnly"`
	Breakdown      []BreakdownRow `json:"breakdown"`
}

// BreakdownRow is one dimension of a suggestion.
type BreakdownRow struct {
	Key          string  `json:"key"`
	Label        string  `json:"label"`
	Score        float64 `json:"score"`
	Weight       string  `json:"weight"`
	Contribution string  `json:"contribution"`
	Rationale    string  `json:"rationale"`
}

// Identity is a synthetic person record for dedupe and entity resolution.
type Identity struct {
	Name            string
	Email           string
	LinkedInURL     string
	GitHubURL       string
	SourceURL       string
	CurrentCompany  string
	LastContactedAt string
}

// arena copies bytes into C memory so cgo never sees a Go pointer that
// itself points at another Go pointer.
type arena struct {
	ptrs []unsafe.Pointer
}

func (a *arena) free() {
	for _, ptr := range a.ptrs {
		C.free(ptr)
	}
	a.ptrs = nil
}

func (a *arena) bytes(b []byte) C.AriaByteSpan {
	if len(b) == 0 {
		return C.AriaByteSpan{}
	}
	ptr := C.malloc(C.size_t(len(b)))
	a.ptrs = append(a.ptrs, ptr)
	copy(unsafe.Slice((*byte)(ptr), len(b)), b)
	return C.AriaByteSpan{data: (*C.uint8_t)(ptr), len: C.size_t(len(b))}
}

func (a *arena) text(s string) C.AriaByteSpan {
	return a.bytes([]byte(s))
}

func (a *arena) list(items []string) C.AriaSpanList {
	if len(items) == 0 {
		return C.AriaSpanList{}
	}
	spans := make([]C.AriaByteSpan, len(items))
	for i, item := range items {
		spans[i] = a.text(item)
	}
	nbytes := C.size_t(len(spans)) * C.size_t(unsafe.Sizeof(spans[0]))
	ptr := C.malloc(nbytes)
	a.ptrs = append(a.ptrs, ptr)
	copy(unsafe.Slice((*C.AriaByteSpan)(ptr), len(spans)), spans)
	return C.AriaSpanList{items: (*C.AriaByteSpan)(ptr), count: C.size_t(len(spans))}
}

func (k *arena) candidate(c Candidate) C.AriaCandidateIn {
	out := C.AriaCandidateIn{
		tech_stack:               k.list(c.TechStack),
		company_stage_experience: k.list(c.CompanyStages),
		industry_experience:      k.list(c.Industries),
		location:                 k.text(c.Location),
		timezone:                 k.text(c.Timezone),
		recent_activity:          k.text(c.RecentActivity),
	}
	if c.Years != nil {
		out.years_experience = C.double(*c.Years)
		out.years_known = 1
	}
	return out
}

func (k *arena) job(job Job) C.AriaJobIn {
	out := C.AriaJobIn{
		location_type:        k.text(job.LocationType),
		location:             k.text(job.Location),
		regions:              k.list(job.Regions),
		timezone:             k.text(job.Timezone),
		required_skills:      k.list(job.RequiredSkills),
		nice_to_have_skills:  k.list(job.NiceToHaveSkills),
		company_stage_target: k.list(job.CompanyStages),
		industry_experience:  k.list(job.Industries),
	}
	if job.MinYears != nil {
		out.min_years = C.double(*job.MinYears)
		out.has_min_years = 1
	}
	if job.MaxYears != nil {
		out.max_years = C.double(*job.MaxYears)
		out.has_max_years = 1
	}
	return out
}

func (k *arena) identity(person Identity) C.AriaIdentityIn {
	return C.AriaIdentityIn{
		name:              k.text(person.Name),
		email:             k.text(person.Email),
		linkedin_url:      k.text(person.LinkedInURL),
		github_url:        k.text(person.GitHubURL),
		source_url:        k.text(person.SourceURL),
		current_company:   k.text(person.CurrentCompany),
		last_contacted_at: k.text(person.LastContactedAt),
	}
}

// ScoreBatch scores every candidate. The result length always equals the input
// length. Low scores are not removed.
func ScoreBatch(candidates []Candidate, job Job, weights *Weights) ([]float64, error) {
	if len(candidates) == 0 {
		return nil, nil
	}
	var mem arena
	defer mem.free()
	rows := make([]C.AriaCandidateIn, len(candidates))
	for i := range candidates {
		rows[i] = mem.candidate(candidates[i])
	}
	cjob := mem.job(job)
	scores := make([]C.double, len(candidates))
	flags := make([]C.int32_t, len(candidates))
	var weight C.AriaWeightsIn
	var weightPtr *C.AriaWeightsIn
	if weights != nil {
		weight = C.AriaWeightsIn{
			skills:        C.double(weights.Skills),
			experience:    C.double(weights.Experience),
			company_stage: C.double(weights.CompanyStage),
			industry:      C.double(weights.Industry),
			location:      C.double(weights.Location),
			activity:      C.double(weights.Activity),
		}
		weightPtr = &weight
	}
	rc := C.aria_score_batch(&rows[0], C.size_t(len(rows)), &cjob, weightPtr, &scores[0], &flags[0])
	if err := status(rc); err != nil {
		return nil, err
	}
	out := make([]float64, len(scores))
	for i, score := range scores {
		if flags[i] != 1 {
			return nil, fmt.Errorf("candidate %d was not marked suggestion-only", i)
		}
		out[i] = float64(score)
	}
	return out, nil
}

// ScoreOne returns the breakdown JSON for a single candidate.
func ScoreOne(candidate Candidate, job Job, weights *Weights) (Score, error) {
	var mem arena
	defer mem.free()
	row := mem.candidate(candidate)
	cjob := mem.job(job)
	var weight C.AriaWeightsIn
	var weightPtr *C.AriaWeightsIn
	if weights != nil {
		weight = C.AriaWeightsIn{
			skills:        C.double(weights.Skills),
			experience:    C.double(weights.Experience),
			company_stage: C.double(weights.CompanyStage),
			industry:      C.double(weights.Industry),
			location:      C.double(weights.Location),
			activity:      C.double(weights.Activity),
		}
		weightPtr = &weight
	}
	buf := make([]byte, 8192)
	var n C.size_t
	rc := C.aria_score_one_json(&row, &cjob, weightPtr, (*C.char)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)), &n)
	if err := status(rc); err != nil {
		return Score{}, err
	}
	var parsed Score
	if err := unmarshalJSON(buf[:n], &parsed); err != nil {
		return Score{}, err
	}
	if !parsed.SuggestionOnly {
		return Score{}, fmt.Errorf("score was not suggestion-only")
	}
	return parsed, nil
}

// Rank returns the input indexes from highest score to lowest.
// Every index is present. Nothing is rejected.
func Rank(scores []float64) ([]int, error) {
	if len(scores) == 0 {
		return nil, nil
	}
	raw := make([]C.double, len(scores))
	for i, score := range scores {
		raw[i] = C.double(score)
	}
	order := make([]C.uint32_t, len(scores))
	rc := C.aria_rank_suggestions(&raw[0], C.size_t(len(raw)), &order[0])
	if err := status(rc); err != nil {
		return nil, err
	}
	out := make([]int, len(order))
	seen := make([]bool, len(order))
	for i, index := range order {
		out[i] = int(index)
		if out[i] < 0 || out[i] >= len(seen) || seen[out[i]] {
			return nil, fmt.Errorf("rank dropped or repeated index %d", out[i])
		}
		seen[out[i]] = true
	}
	return out, nil
}

// ApprovalHash is the lowercase SHA-256 of the canonical exact text.
func ApprovalHash(channel, recipient, subject, body, notice []byte) (string, error) {
	var out [65]C.char
	rc := C.aria_approval_hash(
		bytePtr(channel), C.size_t(len(channel)),
		bytePtr(recipient), C.size_t(len(recipient)),
		bytePtr(subject), C.size_t(len(subject)),
		bytePtr(body), C.size_t(len(body)),
		bytePtr(notice), C.size_t(len(notice)),
		&out[0],
	)
	if err := status(rc); err != nil {
		return "", err
	}
	buf := make([]byte, 0, 64)
	for i := 0; i < 64; i++ {
		if out[i] == 0 {
			break
		}
		buf = append(buf, byte(out[i]))
	}
	return string(buf), nil
}

// Transition applies one named action. A stay in to_hire is not an error.
func Transition(stage, action, reason, contractID string, dnaIntegrated bool) (string, bool, error) {
	cStage := C.CString(stage)
	cAction := C.CString(action)
	cReason := C.CString(reason)
	cContract := C.CString(contractID)
	defer C.free(unsafe.Pointer(cStage))
	defer C.free(unsafe.Pointer(cAction))
	defer C.free(unsafe.Pointer(cReason))
	defer C.free(unsafe.Pointer(cContract))
	buf := make([]byte, 32)
	var stayed C.int32_t
	dna := C.int32_t(0)
	if dnaIntegrated {
		dna = 1
	}
	rc := C.aria_pipeline_transition(
		cStage,
		cAction,
		cReason,
		cContract,
		dna,
		(*C.char)(unsafe.Pointer(&buf[0])),
		C.size_t(len(buf)),
		&stayed,
	)
	next := cString(buf)
	if err := status(rc); err != nil {
		return next, stayed != 0, err
	}
	return next, stayed != 0, nil
}

// ResolveEntities returns the cluster root index of each record.
func ResolveEntities(records []Identity) ([]int, error) {
	if len(records) == 0 {
		return nil, nil
	}
	var mem arena
	defer mem.free()
	rows := make([]C.AriaIdentityIn, len(records))
	for i := range records {
		rows[i] = mem.identity(records[i])
	}
	out := make([]C.uint32_t, len(records))
	rc := C.aria_resolve_entities(&rows[0], C.size_t(len(rows)), &out[0])
	if err := status(rc); err != nil {
		return nil, err
	}
	roots := make([]int, len(out))
	for i, root := range out {
		roots[i] = int(root)
	}
	return roots, nil
}

func bytePtr(b []byte) *C.uint8_t {
	if len(b) == 0 {
		return nil
	}
	return (*C.uint8_t)(unsafe.Pointer(&b[0]))
}

func cString(buf []byte) string {
	n := 0
	for n < len(buf) && buf[n] != 0 {
		n++
	}
	return string(buf[:n])
}

func status(rc C.int32_t) error {
	switch rc {
	case C.ARIA_OK:
		return nil
	case C.ARIA_ERR_INVALID:
		return fmt.Errorf("aria: invalid argument")
	case C.ARIA_ERR_BUFFER:
		return fmt.Errorf("aria: buffer too small")
	case C.ARIA_ERR_UTF8:
		return fmt.Errorf("aria: text is not utf-8")
	case C.ARIA_ERR_TERMINAL:
		return fmt.Errorf("aria: terminal stage")
	case C.ARIA_ERR_REASON:
		return fmt.Errorf("aria: a reason is required")
	case C.ARIA_ERR_ILLEGAL:
		return fmt.Errorf("aria: illegal transition")
	case C.ARIA_ERR_PANIC:
		return fmt.Errorf("aria: core panic")
	default:
		return fmt.Errorf("aria: status %d", int(rc))
	}
}

// unmarshalJSON is a small wrapper so the call site stays obvious.
func unmarshalJSON(buf []byte, dest any) error {
	return jsonUnmarshal(buf, dest)
}
