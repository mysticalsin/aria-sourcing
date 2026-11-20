package ingest

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/ingest/dedupe"
	"github.com/mysticalsin/aria-sourcing/services/ingest/errqueue"
	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
	"github.com/mysticalsin/aria-sourcing/services/ingest/parse"
	"github.com/mysticalsin/aria-sourcing/services/ingest/privacy"
	"github.com/mysticalsin/aria-sourcing/services/ingest/source"
	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

// document is the stored upload. It keeps structured fields and the origin
// slugs. It does not keep the extracted text. Raw bytes live in Worker.raw
// and are dropped by retention without touching this struct's fields.
type document struct {
	id           string
	origin       source.Origin
	bytes        int
	attempts     int
	machine      *state.Machine
	reason       state.Reason
	root         state.Reason
	retryable    bool
	parsed       parse.CV
	mapping      source.Mapping
	duplicateOf  string
	sawRaw       bool
	rawScheduled bool
	rawPurged    bool
}

func (d *document) clone() *document {
	if d == nil {
		return nil
	}
	cp := *d
	cp.machine = d.machine.Clone()
	cp.parsed = cloneCV(d.parsed)
	return &cp
}

func cloneCV(cv parse.CV) parse.CV {
	cv.Skills = append([]string(nil), cv.Skills...)
	cv.Languages = append([]string(nil), cv.Languages...)
	cv.Experience = append([]parse.Role(nil), cv.Experience...)
	return cv
}

// Ingest runs the machine for a new upload. A second call with the same id
// returns the stored result and does not reprocess; use Retry to re-enter
// from error_queue. Business failures are a Result in error_queue with a
// nil error. The error return is for a bad id, a cancelled context, or a
// broken state transition.
func (w *Worker) Ingest(ctx context.Context, up Upload) (Result, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !idOK(up.ID) {
		return Result{}, errOpaqueID
	}
	if doc, ok := w.docs[up.ID]; ok {
		return doc.result(), nil
	}
	doc := &document{
		id:       up.ID,
		origin:   source.Sanitize(up.Origin),
		bytes:    len(up.Bytes),
		attempts: 1,
		machine:  state.Start(),
	}
	w.log(doc, "", state.Uploaded, OpTransition)
	return w.finish(ctx, doc, up.Bytes, true)
}

// Retry re-enters a queued upload at uploaded. A document that is not in
// error_queue is returned as it is. When the attempt cap is already spent,
// the row stays queued as retries_exhausted.
func (w *Worker) Retry(ctx context.Context, uploadID string) (Result, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !idOK(uploadID) {
		return Result{}, errOpaqueID
	}
	doc, ok := w.docs[uploadID]
	if !ok {
		return Result{}, ErrNotFound
	}
	if doc.machine.Current() != state.ErrorQueue {
		return doc.result(), nil
	}
	if !doc.retryable || doc.attempts >= w.maxAttempts {
		return w.exhaust(doc), nil
	}
	next := doc.clone()
	next.attempts++
	next.reason = ""
	if err := w.enter(next, state.Uploaded); err != nil {
		return Result{}, err
	}
	if next.rawPurged || (next.sawRaw && !w.hasRaw(uploadID)) {
		return w.fail(next, state.ReasonRawExpired)
	}
	if !next.sawRaw && (next.root == state.ReasonEmptyFile || next.root == state.ReasonFileTooLarge) {
		return w.fail(next, next.root)
	}
	raw, _ := w.getRaw(uploadID)
	return w.finish(ctx, next, raw, false)
}

// Errors returns the sourcing-error queue in first-seen order.
func (w *Worker) Errors() []errqueue.Item {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.queue.List()
}

// Snapshot returns the stored result.
func (w *Worker) Snapshot(id string) (Result, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	doc, ok := w.docs[id]
	if !ok {
		return Result{}, false
	}
	return doc.result(), true
}

// RawStored reports whether the raw file is still held for id.
func (w *Worker) RawStored(id string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.hasRaw(id)
}

// PurgeStats counts copies removed by one purge pass.
type PurgeStats struct {
	Raw      int
	Profiles int
}

// PurgeDue deletes raw bytes and blanks parsed profiles whose retention
// deadline has passed. The pipeline state and the UTM mapping are kept:
// the audit of "where this file came from" is not the CV body. When the
// sink implements source.Erasable, the applicant copy is erased too.
func (w *Worker) PurgeDue(now time.Time) PurgeStats {
	w.mu.Lock()
	defer w.mu.Unlock()
	var stats PurgeStats
	for _, due := range w.retention.Due(now) {
		switch due.Kind {
		case privacy.KindRaw:
			if w.deleteRaw(due.UploadID) {
				stats.Raw++
			}
			if doc, ok := w.docs[due.UploadID]; ok {
				doc.rawPurged = true
			}
			w.logID(due.UploadID, OpPurgeRaw)
		case privacy.KindProfile:
			if doc, ok := w.docs[due.UploadID]; ok {
				doc.parsed = parse.CV{}
				stats.Profiles++
			}
			if e, ok := w.sink.(source.Erasable); ok {
				_ = e.EraseApplicant(context.Background(), due.UploadID)
			}
			w.logID(due.UploadID, OpPurgeProfile)
		}
		w.retention.MarkPurged(due.UploadID, due.Kind, now)
	}
	return stats
}

func (w *Worker) finish(ctx context.Context, doc *document, data []byte, storeRaw bool) (Result, error) {
	if err := ctx.Err(); err != nil {
		return w.unsaved(doc, err)
	}
	mapping, err := source.Map(doc.origin)
	if err != nil {
		return w.fail(doc, reasonOf(err))
	}
	doc.mapping = mapping
	if len(data) == 0 {
		return w.fail(doc, state.ReasonEmptyFile)
	}
	if len(data) > w.maxBytes {
		return w.fail(doc, state.ReasonFileTooLarge)
	}
	if storeRaw && !w.hasRaw(doc.id) {
		w.putRaw(doc.id, data)
		doc.sawRaw = true
	}
	text, reason, pullErr := w.pullText(ctx, doc, data)
	if pullErr != nil {
		// A first attempt that never reached the queue must not keep the
		// file. A retry still has the previous row, so its bytes stay.
		if ctx.Err() != nil {
			return w.unsaved(doc, ctx.Err())
		}
		return w.unsaved(doc, pullErr)
	}
	if reason != "" {
		return w.fail(doc, reason)
	}
	cv, ok := w.parser.Parse(text)
	if !ok {
		return w.fail(doc, state.ReasonParseFailed)
	}
	doc.parsed = cv
	if err := w.enter(doc, state.Parsed); err != nil {
		return w.unsaved(doc, err)
	}
	match, err := w.deduper.Observe(ctx, dedupe.Fingerprint{
		UploadID: doc.id,
		Email:    cv.Contact.Email,
		Phone:    cv.Contact.Phone,
		Name:     cv.Name,
	})
	if err != nil {
		if ctx.Err() != nil {
			return w.unsaved(doc, ctx.Err())
		}
		return w.fail(doc, state.ReasonDedupeFailed)
	}
	if match != nil {
		doc.duplicateOf = match.UploadID
	}
	if err := w.enter(doc, state.Deduped); err != nil {
		return w.unsaved(doc, err)
	}
	if w.sink != nil {
		rec := source.Record{
			IdempotencyKey: source.IdempotencyKey(doc.id),
			UploadID:       doc.id,
			Stage:          doc.mapping.Stage,
			UTM:            doc.mapping.UTM,
			OdooSource:     doc.mapping.OdooSource,
			DuplicateOf:    doc.duplicateOf,
			Applicant:      toApplicant(cv),
		}
		if err := w.sink.UpsertSource(ctx, rec); err != nil {
			if ctx.Err() != nil {
				return w.unsaved(doc, ctx.Err())
			}
			// The sink error is dropped on purpose. It may quote the applicant.
			return w.fail(doc, state.ReasonSinkFailed)
		}
	}
	if err := w.enter(doc, state.ReadyForToRate); err != nil {
		return w.unsaved(doc, err)
	}
	w.retention.Schedule(privacy.Deadline{
		UploadID: doc.id,
		Kind:     privacy.KindProfile,
		Until:    w.now().Add(w.profileTTL),
	})
	w.queue.Remove(doc.id)
	w.save(doc)
	return doc.result(), nil
}

func (w *Worker) pullText(ctx context.Context, doc *document, data []byte) (string, state.Reason, error) {
	if err := ctx.Err(); err != nil {
		return "", "", err
	}
	switch extract.Sniff(data) {
	case extract.KindPDF:
		text, err := w.extractor.ExtractText(data)
		if err != nil {
			if errors.Is(err, extract.ErrUnreadable) {
				return "", state.ReasonUnreadable, nil
			}
			return "", state.ReasonExtractFailed, nil
		}
		if extract.EnoughText(text) {
			if err := w.enter(doc, state.TextExtracted); err != nil {
				return "", "", err
			}
			return text, "", nil
		}
		if err := w.enter(doc, state.OCRNeeded); err != nil {
			return "", "", err
		}
		ocrCtx, cancel := w.ocrContext(ctx)
		defer cancel()
		pages, err := extract.RasterPDF(ocrCtx, data)
		if err != nil {
			if ctx.Err() != nil {
				return "", "", ctx.Err()
			}
			if ocrCtx.Err() != nil {
				return "", state.ReasonOCRFailed, nil
			}
			if errors.Is(err, extract.ErrPageTooLarge) {
				return "", state.ReasonUnreadable, nil
			}
			return "", state.ReasonOCRUnavailable, nil
		}
		return w.recognize(ctx, ocrCtx, doc, pages)
	case extract.KindPNG, extract.KindJPEG:
		if err := w.enter(doc, state.OCRNeeded); err != nil {
			return "", "", err
		}
		ocrCtx, cancel := w.ocrContext(ctx)
		defer cancel()
		return w.recognize(ctx, ocrCtx, doc, [][]byte{data})
	default:
		return "", state.ReasonUnreadable, nil
	}
}

// ocrContext bounds rasterizing and Tesseract even when the caller
// passed a context with no deadline. The caller's deadline still applies.
func (w *Worker) ocrContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, w.ocrTimeout)
}

func (w *Worker) recognize(parent, ctx context.Context, doc *document, pages [][]byte) (string, state.Reason, error) {
	if len(pages) == 0 {
		return "", state.ReasonOCRFailed, nil
	}
	if w.ocr == nil || !w.ocr.Available() {
		return "", state.ReasonOCRUnavailable, nil
	}
	var b strings.Builder
	for _, page := range pages {
		if parent.Err() != nil {
			return "", "", parent.Err()
		}
		if ctx.Err() != nil {
			return "", state.ReasonOCRFailed, nil
		}
		text, err := w.ocr.Recognize(ctx, page, w.ocrLangs)
		if err != nil {
			if parent.Err() != nil {
				return "", "", parent.Err()
			}
			return "", state.ReasonOCRFailed, nil
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(text)
	}
	if !extract.EnoughText(b.String()) {
		return "", state.ReasonOCRFailed, nil
	}
	if err := w.enter(doc, state.OCRDone); err != nil {
		return "", "", err
	}
	return b.String(), "", nil
}

func (w *Worker) fail(doc *document, reason state.Reason) (Result, error) {
	if doc.root == "" {
		doc.root = reason
	}
	switch {
	case reason == state.ReasonRawExpired:
		doc.reason = state.ReasonRawExpired
		doc.retryable = false
	case doc.attempts >= w.maxAttempts:
		doc.reason = state.ReasonRetriesExhausted
		doc.retryable = false
	default:
		doc.reason = reason
		doc.retryable = true
	}
	if err := w.enter(doc, state.ErrorQueue); err != nil {
		return Result{}, err
	}
	w.queue.Upsert(doc.item(w.now()))
	w.save(doc)
	return doc.result(), nil
}

func (w *Worker) exhaust(doc *document) Result {
	if doc.reason != state.ReasonRetriesExhausted {
		doc.reason = state.ReasonRetriesExhausted
		if doc.root == "" {
			doc.root = state.ReasonRetriesExhausted
		}
		doc.retryable = false
		w.queue.Upsert(doc.item(w.now()))
		w.docs[doc.id] = doc
	}
	return doc.result()
}

// unsaved drops raw bytes when this attempt never joined the queue. A retry
// already has a saved row, so its file is left for the next attempt.
func (w *Worker) unsaved(doc *document, err error) (Result, error) {
	if _, saved := w.docs[doc.id]; !saved {
		w.deleteRaw(doc.id)
	}
	return Result{}, err
}

func (w *Worker) save(doc *document) {
	if doc.sawRaw && !doc.rawScheduled && !doc.rawPurged && w.hasRaw(doc.id) {
		w.retention.Schedule(privacy.Deadline{
			UploadID: doc.id,
			Kind:     privacy.KindRaw,
			Until:    w.now().Add(w.rawTTL),
		})
		doc.rawScheduled = true
	}
	w.docs[doc.id] = doc
}

func (w *Worker) enter(doc *document, next state.State) error {
	from := doc.machine.Current()
	if err := doc.machine.Enter(next); err != nil {
		return err
	}
	w.log(doc, from, next, OpTransition)
	return nil
}

func (w *Worker) log(doc *document, from, to state.State, op string) {
	w.logger.Log(LogEvent{
		UploadID: doc.id,
		From:     from,
		To:       to,
		Reason:   doc.reason,
		Bytes:    doc.bytes,
		Attempt:  doc.attempts,
		Op:       op,
	})
}

func (w *Worker) logID(id, op string) {
	attempt := 0
	size := 0
	if doc, ok := w.docs[id]; ok {
		attempt = doc.attempts
		size = doc.bytes
	}
	w.logger.Log(LogEvent{
		UploadID: id,
		Attempt:  attempt,
		Bytes:    size,
		Op:       op,
	})
}

func (d *document) item(now time.Time) errqueue.Item {
	return errqueue.Item{
		UploadID:    d.id,
		Reason:      d.reason,
		RootReason:  d.root,
		Attempts:    d.attempts,
		Retryable:   d.retryable,
		CVSource:    d.origin.CVSource,
		JobBoard:    d.origin.JobBoard,
		Folder:      d.origin.Folder,
		FolderValue: d.origin.FolderValue,
		DocType:     d.origin.DocType,
		FailedAt:    now,
	}
}

func (d *document) result() Result {
	return Result{
		UploadID:    d.id,
		State:       d.machine.Current(),
		History:     d.machine.History(),
		Reason:      d.reason,
		RootReason:  d.root,
		Attempts:    d.attempts,
		Retryable:   d.retryable,
		Parsed:      cloneCV(d.parsed),
		Mapping:     d.mapping,
		DuplicateOf: d.duplicateOf,
	}
}

func (w *Worker) now() time.Time { return w.clock() }

func (w *Worker) hasRaw(id string) bool {
	_, ok := w.raw[id]
	return ok
}

func (w *Worker) getRaw(id string) ([]byte, bool) {
	b, ok := w.raw[id]
	return b, ok
}

func (w *Worker) putRaw(id string, b []byte) {
	cp := make([]byte, len(b))
	copy(cp, b)
	w.raw[id] = cp
}

func (w *Worker) deleteRaw(id string) bool {
	if _, ok := w.raw[id]; !ok {
		return false
	}
	delete(w.raw, id)
	return true
}

func reasonOf(err error) state.Reason {
	switch {
	case errors.Is(err, source.ErrUnknownFolder):
		return state.ReasonUnknownFolder
	case errors.Is(err, source.ErrUnknownDocType):
		return state.ReasonUnknownDocType
	default:
		return state.ReasonUnsanctioned
	}
}

func toApplicant(cv parse.CV) source.Applicant {
	roles := make([]source.Role, len(cv.Experience))
	for i, role := range cv.Experience {
		roles[i] = source.Role{
			Title:   role.Title,
			Company: role.Company,
			Start:   role.Start,
			End:     role.End,
		}
	}
	return source.Applicant{
		Name:       cv.Name,
		Email:      cv.Contact.Email,
		Phone:      cv.Contact.Phone,
		Location:   cv.Location,
		Skills:     append([]string(nil), cv.Skills...),
		Languages:  append([]string(nil), cv.Languages...),
		Experience: roles,
	}
}
