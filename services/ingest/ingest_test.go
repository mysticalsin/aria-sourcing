package ingest_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/ingest"
	"github.com/mysticalsin/aria-sourcing/services/ingest/dedupe"
	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
	"github.com/mysticalsin/aria-sourcing/services/ingest/fixture"
	"github.com/mysticalsin/aria-sourcing/services/ingest/parse"
	"github.com/mysticalsin/aria-sourcing/services/ingest/source"
	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

func TestOcrFieldsOnSyntheticCvs(t *testing.T) {
	w, _, sink := testWorker(t, ingest.Options{})
	var got, gold []parse.CV
	for i, fx := range syntheticCVs {
		res, err := w.Ingest(context.Background(), ingest.Upload{
			ID:    fmt.Sprintf("cv-%d", i+1),
			Bytes: extract.BuildTextPDF(fx.lines),
			Origin: source.Origin{
				CVSource: "toast-upload",
				Folder:   "holding",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if res.State != state.ReadyForToRate {
			t.Fatalf("%s state %s reason %s history %v", fx.who, res.State, res.Reason, res.History)
		}
		wantHist := []state.State{state.Uploaded, state.TextExtracted, state.Parsed, state.Deduped, state.ReadyForToRate}
		if !sameHistory(res.History, wantHist) {
			t.Fatalf("%s history %v", fx.who, res.History)
		}
		if !strings.HasSuffix(res.Parsed.Contact.Email, "@example.test") {
			t.Fatalf("%s email %s is not synthetic", fx.who, res.Parsed.Contact.Email)
		}
		got = append(got, res.Parsed)
		gold = append(gold, fx.gold)
	}
	score := microF1(got, gold)
	t.Logf("synthetic CV field micro-F1 %.3f", score)
	if score < 0.9 {
		t.Fatalf("micro F1 %.3f < 0.9\n%s", score, diffReport(got, gold))
	}
	if sink.Calls() != len(syntheticCVs) || sink.Len() != len(syntheticCVs) {
		t.Fatalf("sink calls %d len %d", sink.Calls(), sink.Len())
	}
}

func TestTextPathSkipsOCR(t *testing.T) {
	spy := &spyOCR{}
	w, _, _ := testWorker(t, ingest.Options{OCR: spy})
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:     "text-1",
		Bytes:  extract.BuildTextPDF(syntheticCVs[0].lines),
		Origin: source.Origin{CVSource: "toast-upload", Folder: "holding"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ReadyForToRate {
		t.Fatalf("state %s reason %s", res.State, res.Reason)
	}
	if spy.calls != 0 {
		t.Fatalf("text layer called OCR %d times", spy.calls)
	}
}

func TestScannedImageOCRPath(t *testing.T) {
	font := dejavu(t)
	lines := []string{
		"Name: Casey Example",
		"Email: casey.scan@example.test",
		"Phone: +33 1 99 00 11 22",
		"Location: Lyon, France",
		"Skills: Go, PostgreSQL",
		"Languages: English, French",
		"Experience:",
		"2022-2024 Recruiter at Example Consulting",
	}
	png, err := fixture.RenderPNG(lines, font)
	if err != nil {
		t.Fatal(err)
	}
	w, _, _ := testWorker(t, ingest.Options{})
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:    "scan-1",
		Bytes: png,
		Origin: source.Origin{
			CVSource:    "candidate-portal",
			Folder:      "country",
			FolderValue: "FR",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ReadyForToRate {
		t.Fatalf("state %s reason %s history %v", res.State, res.Reason, res.History)
	}
	wantHist := []state.State{state.Uploaded, state.OCRNeeded, state.OCRDone, state.Parsed, state.Deduped, state.ReadyForToRate}
	if !sameHistory(res.History, wantHist) {
		t.Fatalf("history %v", res.History)
	}
	if res.Parsed.Name != "Casey Example" {
		t.Fatalf("name %q", res.Parsed.Name)
	}
	if res.Parsed.Contact.Email != "casey.scan@example.test" {
		t.Fatalf("email %q", res.Parsed.Contact.Email)
	}
	if parse.NormPhone(res.Parsed.Contact.Phone) != "+33199001122" {
		t.Fatalf("phone %q", res.Parsed.Contact.Phone)
	}
	if res.Parsed.Location != "Lyon, France" {
		t.Fatalf("location %q", res.Parsed.Location)
	}
	if !sameSet(res.Parsed.Skills, []string{"Go", "PostgreSQL"}) {
		t.Fatalf("skills %v", res.Parsed.Skills)
	}
	if !sameSet(res.Parsed.Languages, []string{"English", "French"}) {
		t.Fatalf("languages %v", res.Parsed.Languages)
	}
	if len(res.Parsed.Experience) != 1 ||
		res.Parsed.Experience[0].Title != "Recruiter" ||
		res.Parsed.Experience[0].Company != "Example Consulting" ||
		res.Parsed.Experience[0].Start != "2022" ||
		res.Parsed.Experience[0].End != "2024" {
		t.Fatalf("experience %+v", res.Parsed.Experience)
	}
	if res.Mapping.UTM.Campaign != "country:fr" || res.Mapping.Stage != source.StageToRate {
		t.Fatalf("mapping %+v", res.Mapping)
	}
}

func TestTextlessPDFGoesToOCR(t *testing.T) {
	w, _, sink := testWorker(t, ingest.Options{})
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:     "blank-1",
		Bytes:  extract.BuildTextPDF(nil),
		Origin: source.Origin{CVSource: "toast-upload", Folder: "holding"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ErrorQueue {
		t.Fatalf("state %s", res.State)
	}
	if !containsState(res.History, state.OCRNeeded) || containsState(res.History, state.TextExtracted) {
		t.Fatalf("history %v", res.History)
	}
	if res.Reason != state.ReasonOCRFailed && res.Reason != state.ReasonOCRUnavailable {
		t.Fatalf("reason %s", res.Reason)
	}
	if sink.Calls() != 0 {
		t.Fatalf("sink called on a blank page")
	}
}

func TestFailedIngestLandsInErrorQueue(t *testing.T) {
	w, log, sink := testWorker(t, ingest.Options{})
	cases := []struct {
		id     string
		body   []byte
		reason state.Reason
		ocr    bool
	}{
		{id: "bad-1", body: []byte("this is not a cv SENTINEL-BODY"), reason: state.ReasonUnreadable},
		{id: "bad-2", body: []byte("%PDF-1.4\nnot a body"), reason: state.ReasonUnreadable},
		{id: "bad-3", body: nil, reason: state.ReasonEmptyFile},
		{id: "bad-4", body: []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00}, reason: state.ReasonOCRFailed, ocr: true},
	}
	for _, tc := range cases {
		res, err := w.Ingest(context.Background(), ingest.Upload{
			ID:     tc.id,
			Bytes:  tc.body,
			Origin: source.Origin{CVSource: "toast-upload", Folder: "holding"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if res.State != state.ErrorQueue {
			t.Fatalf("%s state %s", tc.id, res.State)
		}
		if tc.ocr {
			if res.Reason != state.ReasonOCRFailed && res.Reason != state.ReasonOCRUnavailable {
				t.Fatalf("%s reason %s", tc.id, res.Reason)
			}
			if !containsState(res.History, state.OCRNeeded) {
				t.Fatalf("%s history %v", tc.id, res.History)
			}
		} else if res.Reason != tc.reason {
			t.Fatalf("%s reason %s want %s history %v", tc.id, res.Reason, tc.reason, res.History)
		}
		if res.History[0] != state.Uploaded || res.History[len(res.History)-1] != state.ErrorQueue {
			t.Fatalf("%s history %v", tc.id, res.History)
		}
		// Idempotent: a second ingest does not reprocess or bump attempts.
		again, err := w.Ingest(context.Background(), ingest.Upload{
			ID: tc.id, Bytes: tc.body,
			Origin: source.Origin{CVSource: "toast-upload", Folder: "holding"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if again.Attempts != 1 || again.Reason != res.Reason {
			t.Fatalf("replay %+v", again)
		}
	}
	items := w.Errors()
	if len(items) != len(cases) {
		t.Fatalf("queue %d", len(items))
	}
	raw, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "SENTINEL-BODY") {
		t.Fatal("error queue contains file bytes")
	}
	if sink.Calls() != 0 {
		t.Fatal("sink ran for failures")
	}
	for _, ev := range log.Snapshot() {
		blob := fmt.Sprintf("%#v", ev)
		if strings.Contains(blob, "SENTINEL-BODY") {
			t.Fatalf("log event leaked file bytes: %#v", ev)
		}
	}
}

func TestIngestMapsCvSourceAndFolder(t *testing.T) {
	w, _, sink := testWorker(t, ingest.Options{})
	pdf := extract.BuildTextPDF(syntheticCVs[0].lines)
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:    "map-1",
		Bytes: pdf,
		Origin: source.Origin{
			CVSource:    "toast-upload",
			JobBoard:    "indeed",
			Folder:      "need",
			FolderValue: "900001",
			DocType:     "cv",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ReadyForToRate {
		t.Fatalf("state %s reason %s", res.State, res.Reason)
	}
	if res.Mapping.UTM.Source != "indeed" || res.Mapping.UTM.Medium != "job-board" || res.Mapping.UTM.Campaign != "need:900001" {
		t.Fatalf("utm %+v", res.Mapping.UTM)
	}
	if res.Mapping.OdooSource != "Candidate-supplied" || res.Mapping.Stage != source.StageToRate {
		t.Fatalf("odoo %+v", res.Mapping)
	}
	stored, ok := sink.ByUpload("map-1")
	if !ok || stored.UTM.Campaign != "need:900001" || stored.Stage != source.StageToRate {
		t.Fatalf("sink %+v", stored)
	}
	if stored.IdempotencyKey != source.IdempotencyKey("map-1") {
		t.Fatalf("key %s", stored.IdempotencyKey)
	}

	bad, err := w.Ingest(context.Background(), ingest.Upload{
		ID:    "map-2",
		Bytes: pdf,
		Origin: source.Origin{
			CVSource: "linkedin-scrape",
			Folder:   "holding",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if bad.State != state.ErrorQueue || bad.Reason != state.ReasonUnsanctioned {
		t.Fatalf("unsanctioned %+v", bad)
	}
	if !sameHistory(bad.History, []state.State{state.Uploaded, state.ErrorQueue}) {
		t.Fatalf("history %v", bad.History)
	}

	folder, err := w.Ingest(context.Background(), ingest.Upload{
		ID:    "map-3",
		Bytes: pdf,
		Origin: source.Origin{
			CVSource:    "toast-upload",
			Folder:      "need",
			FolderValue: "not a slug",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if folder.State != state.ErrorQueue || folder.Reason != state.ReasonUnknownFolder {
		t.Fatalf("folder %+v", folder)
	}
	item, _ := findError(w, "map-3")
	if item.FolderValue != "" || strings.Contains(item.FolderValue, "slug") {
		t.Fatalf("folder value stored as %q", item.FolderValue)
	}
}

func TestDuplicateDetectionHook(t *testing.T) {
	hook := dedupe.NewMemory()
	w, _, sink := testWorker(t, ingest.Options{Deduper: hook})
	first := cvWithEmail("Casey Example", "shared.person@example.test")
	second := cvWithEmail("Other Person", "shared.person@example.test")
	third := cvWithEmail("Casey Example", "other.person@example.test")
	a, err := w.Ingest(context.Background(), ingest.Upload{ID: "dup-1", Bytes: extract.BuildTextPDF(first), Origin: holding()})
	if err != nil {
		t.Fatal(err)
	}
	b, err := w.Ingest(context.Background(), ingest.Upload{ID: "dup-2", Bytes: extract.BuildTextPDF(second), Origin: holding()})
	if err != nil {
		t.Fatal(err)
	}
	c, err := w.Ingest(context.Background(), ingest.Upload{ID: "dup-3", Bytes: extract.BuildTextPDF(third), Origin: holding()})
	if err != nil {
		t.Fatal(err)
	}
	if a.State != state.ReadyForToRate || b.State != state.ReadyForToRate || c.State != state.ReadyForToRate {
		t.Fatalf("states %s %s %s", a.State, b.State, c.State)
	}
	if a.DuplicateOf != "" || b.DuplicateOf != "dup-1" || c.DuplicateOf != "" {
		t.Fatalf("dups a=%q b=%q c=%q", a.DuplicateOf, b.DuplicateOf, c.DuplicateOf)
	}
	if !containsState(b.History, state.Deduped) {
		t.Fatalf("history %v", b.History)
	}
	if hook.Calls() != 3 {
		t.Fatalf("hook calls %d", hook.Calls())
	}
	row, ok := sink.ByUpload("dup-2")
	if !ok || row.DuplicateOf != "dup-1" {
		t.Fatalf("sink duplicate %+v", row)
	}
}

func TestRetryFromErrorQueue(t *testing.T) {
	flaky := &flakyExtract{fail: 1}
	w, log, sink := testWorker(t, ingest.Options{Extractor: flaky, MaxAttempts: 3})
	lines := cvWithEmail("Riley Sample", "riley.sample@example.test")
	up := ingest.Upload{ID: "retry-1", Bytes: extract.BuildTextPDF(lines), Origin: holding()}
	res, err := w.Ingest(context.Background(), up)
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ErrorQueue || res.Reason != state.ReasonExtractFailed || !res.Retryable {
		t.Fatalf("first %+v", res)
	}
	if len(w.Errors()) != 1 {
		t.Fatal("expected the row on the sourcing-error queue")
	}
	again, err := w.Retry(context.Background(), "retry-1")
	if err != nil {
		t.Fatal(err)
	}
	if again.State != state.ReadyForToRate || again.Attempts != 2 || again.DuplicateOf != "" {
		t.Fatalf("retry %+v", again)
	}
	if len(w.Errors()) != 0 {
		t.Fatalf("queue not cleared: %+v", w.Errors())
	}
	if !containsState(again.History, state.ErrorQueue) || again.History[len(again.History)-1] != state.ReadyForToRate {
		t.Fatalf("history %v", again.History)
	}
	if sink.Calls() != 1 {
		t.Fatalf("sink calls %d", sink.Calls())
	}
	for _, ev := range log.Snapshot() {
		if strings.Contains(fmt.Sprintf("%#v", ev), "riley.sample@example.test") {
			t.Fatalf("retry log leaked email: %#v", ev)
		}
	}
}

func TestRetriesExhausted(t *testing.T) {
	w, _, _ := testWorker(t, ingest.Options{Extractor: boomExtract{}, MaxAttempts: 2})
	up := ingest.Upload{ID: "ex-1", Bytes: extract.BuildTextPDF(syntheticCVs[0].lines), Origin: holding()}
	first, err := w.Ingest(context.Background(), up)
	if err != nil {
		t.Fatal(err)
	}
	if first.Reason != state.ReasonExtractFailed || first.Attempts != 1 {
		t.Fatalf("first %+v", first)
	}
	second, err := w.Retry(context.Background(), "ex-1")
	if err != nil {
		t.Fatal(err)
	}
	if second.Reason != state.ReasonRetriesExhausted || second.RootReason != state.ReasonExtractFailed || second.Retryable {
		t.Fatalf("second %+v", second)
	}
	third, err := w.Retry(context.Background(), "ex-1")
	if err != nil {
		t.Fatal(err)
	}
	if third.Attempts != 2 || third.Reason != state.ReasonRetriesExhausted {
		t.Fatalf("third %+v", third)
	}
}

func TestLogsOmitCVContent(t *testing.T) {
	const (
		email    = "casey.zorblax@example.test"
		name     = "Casey Example"
		skill    = "Zorblax"
		phone    = "+33 1 99 00 11 22"
		sentence = "purple hedgehog method"
	)
	lines := []string{
		"Name: " + name,
		"Email: " + email,
		"Phone: " + phone,
		"Location: Lyon, France",
		"Skills: Go, " + skill,
		"Languages: English",
		sentence,
		"Experience:",
		"2020-2024 | Recruiter | Example Consulting",
	}
	w, log, _ := testWorker(t, ingest.Options{})
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:     "pii-1",
		Bytes:  extract.BuildTextPDF(lines),
		Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ReadyForToRate || res.Parsed.Contact.Email != email || !containsSkill(res.Parsed.Skills, skill) {
		t.Fatalf("parse did not see the fixture: %+v", res.Parsed)
	}
	forbid := []string{email, name, skill, phone, sentence, "99001122"}
	assertNoForbidden(t, log.Snapshot(), w.Errors(), forbid)

	// A second upload puts the sentinel in the origin instead of a slug.
	// Sanitize must drop it before the queue row is stored.
	bad, err := w.Ingest(context.Background(), ingest.Upload{
		ID:    "pii-2",
		Bytes: extract.BuildTextPDF(lines),
		Origin: source.Origin{
			CVSource:    name,
			Folder:      "need",
			FolderValue: email,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if bad.State != state.ErrorQueue {
		t.Fatalf("state %s", bad.State)
	}
	assertNoForbidden(t, log.Snapshot(), w.Errors(), forbid)

	// Sink failures can quote the applicant. That string must not reach the log.
	sink := &quotingSink{fail: 1, inner: source.NewMemory()}
	w2, log2, _ := testWorker(t, ingest.Options{Sink: sink})
	failed, err := w2.Ingest(context.Background(), ingest.Upload{
		ID: "pii-3", Bytes: extract.BuildTextPDF(lines), Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if failed.Reason != state.ReasonSinkFailed {
		t.Fatalf("reason %s", failed.Reason)
	}
	assertNoForbidden(t, log2.Snapshot(), w2.Errors(), forbid)
}

func TestRetentionHookPurgesRawCV(t *testing.T) {
	now := fixedInstant()
	w, log, sink := testWorker(t, ingest.Options{
		Now:              func() time.Time { return now },
		RawRetention:     time.Hour,
		ProfileRetention: 24 * time.Hour,
	})
	email := "avery.demo@example.test"
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:     "ret-1",
		Bytes:  extract.BuildTextPDF(cvWithEmail("Avery Demo", email)),
		Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ReadyForToRate {
		t.Fatal(res.State)
	}
	if !w.RawStored("ret-1") {
		t.Fatal("raw bytes should be held until the retention deadline")
	}
	early := w.PurgeDue(now.Add(30 * time.Minute))
	if early.Raw != 0 || early.Profiles != 0 || !w.RawStored("ret-1") {
		t.Fatalf("early purge %+v stored %v", early, w.RawStored("ret-1"))
	}
	rawGone := w.PurgeDue(now.Add(2 * time.Hour))
	if rawGone.Raw != 1 || rawGone.Profiles != 0 || w.RawStored("ret-1") {
		t.Fatalf("raw purge %+v stored %v", rawGone, w.RawStored("ret-1"))
	}
	snap, ok := w.Snapshot("ret-1")
	if !ok || snap.Parsed.Contact.Email != email || snap.State != state.ReadyForToRate {
		t.Fatalf("profile should outlive the file: %+v", snap)
	}
	row, _ := sink.ByUpload("ret-1")
	if row.Applicant.Email != email || row.UTM.Campaign != "holding" {
		t.Fatalf("sink before profile purge %+v", row)
	}
	profileGone := w.PurgeDue(now.Add(48 * time.Hour))
	if profileGone.Profiles != 1 {
		t.Fatalf("profile purge %+v", profileGone)
	}
	snap, _ = w.Snapshot("ret-1")
	if snap.Parsed.Name != "" || snap.Parsed.Contact.Email != "" || snap.State != state.ReadyForToRate {
		t.Fatalf("profile not blanked: %+v", snap)
	}
	row, _ = sink.ByUpload("ret-1")
	if row.Applicant.Email != "" || row.UTM.Campaign != "holding" || row.OdooSource == "" {
		t.Fatalf("sink erase %+v", row)
	}
	again := w.PurgeDue(now.Add(72 * time.Hour))
	if again.Raw != 0 || again.Profiles != 0 {
		t.Fatalf("second purge should be a no-op: %+v", again)
	}
	assertNoForbidden(t, log.Snapshot(), nil, []string{email, "Avery Demo"})

	// A failed upload's raw bytes are purged too, and a later retry says so.
	flaky := &flakyExtract{fail: 5}
	w2, _, _ := testWorker(t, ingest.Options{
		Now:          func() time.Time { return now },
		RawRetention: time.Hour,
		Extractor:    flaky,
		MaxAttempts:  4,
	})
	failed, err := w2.Ingest(context.Background(), ingest.Upload{
		ID: "ret-2", Bytes: extract.BuildTextPDF(cvWithEmail("Quinn Placeholder", "quinn.placeholder@example.test")),
		Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if failed.State != state.ErrorQueue || !w2.RawStored("ret-2") {
		t.Fatalf("failed %+v stored %v", failed, w2.RawStored("ret-2"))
	}
	w2.PurgeDue(now.Add(2 * time.Hour))
	if w2.RawStored("ret-2") {
		t.Fatal("failed raw still stored")
	}
	retry, err := w2.Retry(context.Background(), "ret-2")
	if err != nil {
		t.Fatal(err)
	}
	if retry.Reason != state.ReasonRawExpired || retry.Retryable {
		t.Fatalf("retry after purge %+v", retry)
	}
}

func TestExtractTimeoutLandsInErrorQueue(t *testing.T) {
	w, _, _ := testWorker(t, ingest.Options{
		ExtractTimeout: 30 * time.Millisecond,
		Extractor:      blockExtract{},
	})
	start := time.Now()
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID: "slow-extract-1", Bytes: extract.BuildTextPDF(syntheticCVs[0].lines), Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("text extraction was not bounded")
	}
	if res.State != state.ErrorQueue || res.Reason != state.ReasonExtractFailed {
		t.Fatalf("%+v", res)
	}
	if containsState(res.History, state.TextExtracted) {
		t.Fatalf("timed-out extract was treated as text: %v", res.History)
	}
}

type blockExtract struct{}

func (blockExtract) ExtractText([]byte) (string, error) {
	time.Sleep(time.Hour)
	return "", nil
}

func TestOCRTimeoutLandsInErrorQueue(t *testing.T) {
	w, _, _ := testWorker(t, ingest.Options{
		OCRTimeout: 30 * time.Millisecond,
		OCR:        blockOCR{},
	})
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00}
	start := time.Now()
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID: "slow-1", Bytes: png, Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("OCR was not bounded by the worker timeout")
	}
	if res.State != state.ErrorQueue || res.Reason != state.ReasonOCRFailed {
		t.Fatalf("%+v", res)
	}
}

type blockOCR struct{}

func (blockOCR) Available() bool { return true }

func (blockOCR) Recognize(ctx context.Context, _ []byte, _ string) (string, error) {
	<-ctx.Done()
	return "", ctx.Err()
}

func TestUserUnitPageIsRefusedBeforeRaster(t *testing.T) {
	// A letter page with UserUnit 100 is 100 times too large. The cap has
	// to see that scale and refuse the file before pdftoppm starts.
	pdf := bytes.Replace(
		extract.BuildTextPDF(nil),
		[]byte("/MediaBox [0 0 612 792]"),
		[]byte("/MediaBox [0 0 612 792] /UserUnit 100"),
		1,
	)
	if !bytes.Contains(pdf, []byte("/UserUnit 100")) {
		t.Fatal("fixture did not carry UserUnit")
	}
	w, _, _ := testWorker(t, ingest.Options{})
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID: "unit-1", Bytes: pdf, Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ErrorQueue || res.Reason != state.ReasonUnreadable {
		t.Fatalf("state %s reason %s history %v", res.State, res.Reason, res.History)
	}
}

func TestComposeRunsWorkerWithNoNetwork(t *testing.T) {
	body, err := os.ReadFile(filepath.Join(moduleRoot(t), "compose.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body, []byte("network_mode: none")) {
		t.Fatal("services/ingest/compose.yaml must set network_mode: none for the worker")
	}
}

func TestFileTooLargeDoesNotKeepBytes(t *testing.T) {
	w, _, sink := testWorker(t, ingest.Options{MaxBytes: 32})
	body := bytes.Repeat([]byte("x"), 64)
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID: "big-1", Bytes: body, Origin: holding(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ErrorQueue || res.Reason != state.ReasonFileTooLarge {
		t.Fatalf("%+v", res)
	}
	if w.RawStored("big-1") || sink.Calls() != 0 {
		t.Fatal("oversized file was stored or handed off")
	}
}

func TestPhoneShapedIDIsRejectedAndNotLogged(t *testing.T) {
	w, log, _ := testWorker(t, ingest.Options{})
	_, err := w.Ingest(context.Background(), ingest.Upload{
		ID:     "5550100199",
		Bytes:  extract.BuildTextPDF(syntheticCVs[0].lines),
		Origin: holding(),
	})
	if err == nil {
		t.Fatal("phone-shaped id was accepted")
	}
	if strings.Contains(err.Error(), "5550100199") {
		t.Fatal("error echoed the phone id")
	}
	if strings.Contains(fmt.Sprintf("%#v", log.Snapshot()), "5550100199") {
		t.Fatal("phone-shaped id was written to the log")
	}
}

func TestNameShapedIDAndSlugAreNotLogged(t *testing.T) {
	w, log, _ := testWorker(t, ingest.Options{})
	_, err := w.Ingest(context.Background(), ingest.Upload{
		ID:     "Casey-Example",
		Bytes:  extract.BuildTextPDF(syntheticCVs[0].lines),
		Origin: holding(),
	})
	if err == nil {
		t.Fatal("name-shaped id was accepted")
	}
	if strings.Contains(err.Error(), "Casey") {
		t.Fatal("id error echoed the name")
	}
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:    "slug-1",
		Bytes: extract.BuildTextPDF(syntheticCVs[0].lines),
		Origin: source.Origin{
			CVSource:    "toast-upload",
			Folder:      "need",
			FolderValue: "casey-example",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.State != state.ReadyForToRate {
		t.Fatalf("state %s reason %s", res.State, res.Reason)
	}
	blob := fmt.Sprintf("%#v", log.Snapshot())
	for _, needle := range []string{"Casey-Example", "casey-example", "Casey"} {
		if strings.Contains(blob, needle) {
			t.Fatalf("log contains %q", needle)
		}
	}
}

func TestUploadIDMustBeOpaque(t *testing.T) {
	w, log, _ := testWorker(t, ingest.Options{})
	_, err := w.Ingest(context.Background(), ingest.Upload{
		ID:     "casey.sample@example.test",
		Bytes:  extract.BuildTextPDF(syntheticCVs[0].lines),
		Origin: holding(),
	})
	if err == nil {
		t.Fatal("email-shaped id was accepted")
	}
	if strings.Contains(err.Error(), "casey.sample") {
		t.Fatal("id error echoed the address")
	}
	if len(log.Snapshot()) != 0 {
		t.Fatal("rejected id was logged")
	}
	if _, err := w.Retry(context.Background(), "missing-1"); err != ingest.ErrNotFound {
		t.Fatalf("retry missing: %v", err)
	}
}

func TestProductionCodeHasNoPrintLogging(t *testing.T) {
	root := moduleRoot(t)
	var bad []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := string(body)
		scrubbed := strings.ReplaceAll(text, "Fprintln(", "")
		for _, needle := range []string{"fmt.Print", "log.Print", "log.Fatal", "println("} {
			if strings.Contains(scrubbed, needle) {
				bad = append(bad, path+" contains "+needle)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(bad) > 0 {
		t.Fatal(strings.Join(bad, "\n"))
	}
}

func TestLogEventHasNoContentFields(t *testing.T) {
	assertNoContentFields(t, reflect.TypeOf(ingest.LogEvent{}))
	// The queue row is allowed to carry source slugs, not a body.
	typ := reflect.TypeOf(struct {
		UploadID   string
		Reason     string
		RootReason string
		Attempts   int
		Retryable  bool
		CVSource   string
		JobBoard   string
		Folder     string
		DocType    string
	}{})
	assertNoContentFields(t, typ)
}

type spyOCR struct{ calls int }

func (s *spyOCR) Available() bool { return true }
func (s *spyOCR) Recognize(context.Context, []byte, string) (string, error) {
	s.calls++
	return "", fmt.Errorf("ocr should not run")
}

type flakyExtract struct{ fail int }

func (f *flakyExtract) ExtractText(data []byte) (string, error) {
	if f.fail > 0 {
		f.fail--
		return "", fmt.Errorf("temporary extractor fault")
	}
	return extract.PDF{}.ExtractText(data)
}

type boomExtract struct{}

func (boomExtract) ExtractText([]byte) (string, error) {
	return "", fmt.Errorf("extractor down")
}

// quotingSink returns an error that contains the applicant email, which is
// what a careless adapter might do. The worker must not log that error.
type quotingSink struct {
	fail  int
	inner *source.Memory
}

func (q *quotingSink) UpsertSource(ctx context.Context, rec source.Record) error {
	if q.fail > 0 {
		q.fail--
		return fmt.Errorf("odoo down for %s", rec.Applicant.Email)
	}
	return q.inner.UpsertSource(ctx, rec)
}

func testWorker(t *testing.T, opt ingest.Options) (*ingest.Worker, *ingest.SliceLogger, *source.Memory) {
	t.Helper()
	if opt.Now == nil {
		instant := fixedInstant()
		opt.Now = func() time.Time { return instant }
	}
	log := &ingest.SliceLogger{}
	if opt.Logger == nil {
		opt.Logger = log
	} else if existing, ok := opt.Logger.(*ingest.SliceLogger); ok {
		log = existing
	}
	var sink *source.Memory
	if opt.Sink == nil {
		sink = source.NewMemory()
		opt.Sink = sink
	} else if existing, ok := opt.Sink.(*source.Memory); ok {
		sink = existing
	}
	if opt.RawRetention == 0 {
		opt.RawRetention = time.Hour
	}
	if opt.ProfileRetention == 0 {
		opt.ProfileRetention = 24 * time.Hour
	}
	return ingest.New(opt), log, sink
}

func fixedInstant() time.Time {
	return time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
}

func holding() source.Origin {
	return source.Origin{CVSource: "toast-upload", Folder: "holding"}
}

func cvWithEmail(name, email string) []string {
	return []string{
		"Name: " + name,
		"Email: " + email,
		"Phone: +33 1 99 00 11 22",
		"Location: Lyon, France",
		"Skills: Go, PostgreSQL",
		"Languages: English, French",
		"Experience:",
		"2022-2024 | Recruiter | Example Consulting",
	}
}

func dejavu(t *testing.T) string {
	t.Helper()
	candidates := []string{
		"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
		"/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	t.Fatal("install fonts-dejavu-core or fonts-liberation so the OCR fixture can render")
	return ""
}

func sameHistory(got, want []state.State) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range want {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func containsState(h []state.State, s state.State) bool {
	for _, item := range h {
		if item == s {
			return true
		}
	}
	return false
}

func containsSkill(skills []string, want string) bool {
	for _, s := range skills {
		if strings.EqualFold(s, want) {
			return true
		}
	}
	return false
}

func findError(w *ingest.Worker, id string) (item struct {
	FolderValue string
}, ok bool) {
	for _, row := range w.Errors() {
		if row.UploadID == id {
			return struct{ FolderValue string }{FolderValue: row.FolderValue}, true
		}
	}
	return item, false
}

func assertNoForbidden(t *testing.T, events []ingest.LogEvent, items interface{}, forbid []string) {
	t.Helper()
	var blobs []string
	for _, ev := range events {
		blobs = append(blobs, fmt.Sprintf("%#v", ev))
	}
	if items != nil {
		raw, err := json.Marshal(items)
		if err != nil {
			t.Fatal(err)
		}
		blobs = append(blobs, string(raw))
	}
	joined := strings.Join(blobs, "\n")
	for _, needle := range forbid {
		if needle != "" && strings.Contains(joined, needle) {
			t.Fatalf("log or error queue contains %q", needle)
		}
	}
}

func assertNoContentFields(t *testing.T, typ reflect.Type) {
	t.Helper()
	banned := []string{"text", "body", "content", "email", "phone", "skill", "raw", "cvtext", "snippet"}
	for i := 0; i < typ.NumField(); i++ {
		name := strings.ToLower(typ.Field(i).Name)
		for _, bad := range banned {
			if strings.Contains(name, bad) {
				t.Fatalf("field %s looks like CV content", typ.Field(i).Name)
			}
		}
	}
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Dir(file)
}

type fixtureCV struct {
	who   string
	lines []string
	gold  parse.CV
}

func role(title, company, start, end string) parse.Role {
	return parse.Role{Title: title, Company: company, Start: start, End: end}
}

var syntheticCVs = []fixtureCV{
	{
		who: "casey",
		lines: []string{
			"Name: Casey Example",
			"Email: casey.example@example.test",
			"Phone: +33 1 99 00 11 22",
			"Location: Lyon, France",
			"Skills: Go, PostgreSQL, Recruitment operations",
			"Languages: English, French, Portuguese",
			"Experience:",
			"2022-2024 | Recruiter | Example Consulting",
			"2019-2022 | Sourcing Specialist | Sample Staffing",
		},
		gold: parse.CV{
			Name:      "Casey Example",
			Contact:   parse.Contact{Email: "casey.example@example.test", Phone: "+33 1 99 00 11 22"},
			Location:  "Lyon, France",
			Skills:    []string{"Go", "PostgreSQL", "Recruitment operations"},
			Languages: []string{"English", "French", "Portuguese"},
			Experience: []parse.Role{
				role("Recruiter", "Example Consulting", "2022", "2024"),
				role("Sourcing Specialist", "Sample Staffing", "2019", "2022"),
			},
		},
	},
	{
		who: "riley",
		lines: []string{
			"Name: Riley Sample",
			"Email: riley.sample@example.test",
			"Phone: +351 21 000 0000",
			"Location: Lisbon, Portugal",
			"Skills: Kubernetes; Python; and Sourcing",
			"Languages: English, Portuguese",
			"Experience:",
			"2018-2021 | Researcher | Fixture Labs",
		},
		gold: parse.CV{
			Name:      "Riley Sample",
			Contact:   parse.Contact{Email: "riley.sample@example.test", Phone: "+351 21 000 0000"},
			Location:  "Lisbon, Portugal",
			Skills:    []string{"Kubernetes", "Python", "Sourcing"},
			Languages: []string{"English", "Portuguese"},
			Experience: []parse.Role{
				role("Researcher", "Fixture Labs", "2018", "2021"),
			},
		},
	},
	{
		who: "jordan",
		lines: []string{
			"Jordan Fixture",
			"Sourcing specialist",
			"Porto, Portugal",
			"jordan.fixture@example.test",
			"+32 2 000 00 00",
			"",
			"SKILLS",
			"Go",
			"Kubernetes",
			"Sourcing",
			"",
			"LANGUAGES",
			"English",
			"French",
			"",
			"EXPERIENCE",
			"Recruiter at Example Consulting (2020-2023)",
			"Researcher at Fixture Labs (2018-2020)",
			"",
			"EDUCATION",
			"Example University",
		},
		gold: parse.CV{
			Name:      "Jordan Fixture",
			Contact:   parse.Contact{Email: "jordan.fixture@example.test", Phone: "+32 2 000 00 00"},
			Location:  "Porto, Portugal",
			Skills:    []string{"Go", "Kubernetes", "Sourcing"},
			Languages: []string{"English", "French"},
			Experience: []parse.Role{
				role("Recruiter", "Example Consulting", "2020", "2023"),
				role("Researcher", "Fixture Labs", "2018", "2020"),
			},
		},
	},
	{
		who: "avery",
		lines: []string{
			"Avery Demo",
			"Brussels, Belgium",
			"avery.demo@example.test",
			"+32 2 555 01 00",
			"SKILLS",
			"Go, PostgreSQL",
			"LANGUAGES",
			"English, French, and Portuguese",
			"EXPERIENCE",
			"2021-2024 Recruiter at Demo Group",
		},
		gold: parse.CV{
			Name:      "Avery Demo",
			Contact:   parse.Contact{Email: "avery.demo@example.test", Phone: "+32 2 555 01 00"},
			Location:  "Brussels, Belgium",
			Skills:    []string{"Go", "PostgreSQL"},
			Languages: []string{"English", "French", "Portuguese"},
			Experience: []parse.Role{
				role("Recruiter", "Demo Group", "2021", "2024"),
			},
		},
	},
	{
		who: "quinn",
		lines: []string{
			"Name:  Quinn   Placeholder",
			"",
			"Email: Quinn.Placeholder@example.test",
			"Phone: +1 555 010 0199",
			"Location: Toulouse, France",
			"Skills: Go; PostgreSQL; and Sourcing",
			"Languages: English, French",
			"Experience:",
			"2016-2019 | Researcher | Placeholder Partners",
			"2019-2024 | Recruiter | Example Consulting",
		},
		gold: parse.CV{
			Name:      "Quinn Placeholder",
			Contact:   parse.Contact{Email: "quinn.placeholder@example.test", Phone: "+1 555 010 0199"},
			Location:  "Toulouse, France",
			Skills:    []string{"Go", "PostgreSQL", "Sourcing"},
			Languages: []string{"English", "French"},
			Experience: []parse.Role{
				role("Researcher", "Placeholder Partners", "2016", "2019"),
				role("Recruiter", "Example Consulting", "2019", "2024"),
			},
		},
	},
}

func microF1(got, gold []parse.CV) float64 {
	tp, fp, fn := 0, 0, 0
	for i := range gold {
		addExact(&tp, &fp, &fn, got[i].Name, gold[i].Name)
		addExact(&tp, &fp, &fn, got[i].Contact.Email, gold[i].Contact.Email)
		addExact(&tp, &fp, &fn, parse.NormPhone(got[i].Contact.Phone), parse.NormPhone(gold[i].Contact.Phone))
		addExact(&tp, &fp, &fn, got[i].Location, gold[i].Location)
		t, f, n := setCounts(got[i].Skills, gold[i].Skills)
		tp, fp, fn = tp+t, fp+f, fn+n
		t, f, n = setCounts(got[i].Languages, gold[i].Languages)
		tp, fp, fn = tp+t, fp+f, fn+n
		t, f, n = setCounts(roleKeys(got[i].Experience), roleKeys(gold[i].Experience))
		tp, fp, fn = tp+t, fp+f, fn+n
	}
	if tp == 0 {
		return 0
	}
	p := float64(tp) / float64(tp+fp)
	r := float64(tp) / float64(tp+fn)
	if p+r == 0 {
		return 0
	}
	return 2 * p * r / (p + r)
}

func addExact(tp, fp, fn *int, got, gold string) {
	got = strings.ToLower(parse.Collapse(got))
	gold = strings.ToLower(parse.Collapse(gold))
	switch {
	case got == gold:
		if gold != "" {
			*tp++
		}
	case got == "":
		*fn++
	case gold == "":
		*fp++
	default:
		*fp++
		*fn++
	}
}

func setCounts(got, gold []string) (tp, fp, fn int) {
	gset := map[string]int{}
	for _, g := range gold {
		gset[strings.ToLower(parse.Collapse(g))]++
	}
	for _, s := range got {
		k := strings.ToLower(parse.Collapse(s))
		if k == "" {
			continue
		}
		if gset[k] > 0 {
			tp++
			gset[k]--
		} else {
			fp++
		}
	}
	for _, c := range gset {
		fn += c
	}
	return tp, fp, fn
}

func roleKeys(roles []parse.Role) []string {
	out := make([]string, len(roles))
	for i, r := range roles {
		out[i] = strings.ToLower(r.Start + "|" + r.End + "|" + parse.Collapse(r.Title) + "|" + parse.Collapse(r.Company))
	}
	return out
}

func sameSet(got, want []string) bool {
	t, fp, fn := setCounts(got, want)
	return fp == 0 && fn == 0 && t == len(want)
}

func diffReport(got, gold []parse.CV) string {
	var b strings.Builder
	for i := range gold {
		fmt.Fprintf(&b, "fixture %d\n got name=%q email=%q phone=%q loc=%q\n  skills=%v lang=%v exp=%v\n gold name=%q email=%q phone=%q loc=%q\n  skills=%v lang=%v exp=%v\n",
			i, got[i].Name, got[i].Contact.Email, got[i].Contact.Phone, got[i].Location, got[i].Skills, got[i].Languages, got[i].Experience,
			gold[i].Name, gold[i].Contact.Email, gold[i].Contact.Phone, gold[i].Location, gold[i].Skills, gold[i].Languages, gold[i].Experience)
	}
	return b.String()
}
