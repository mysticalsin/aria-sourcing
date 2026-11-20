package ingest

import (
	"errors"
	"regexp"
	"sync"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/ingest/dedupe"
	"github.com/mysticalsin/aria-sourcing/services/ingest/errqueue"
	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
	"github.com/mysticalsin/aria-sourcing/services/ingest/ocr"
	"github.com/mysticalsin/aria-sourcing/services/ingest/parse"
	"github.com/mysticalsin/aria-sourcing/services/ingest/privacy"
	"github.com/mysticalsin/aria-sourcing/services/ingest/source"
	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

// MaxUploadBytes is the most the CLI will read and the worker's default
// file cap. The CLI stats the file and also wraps the reader so a larger
// file is never loaded.
const MaxUploadBytes = 8 << 20

// Default retention until a DPO sets the real periods. Raw bytes are the
// file; the profile is the parsed fields. These are hooks, not a legal
// determination.
const (
	defaultRawRetention     = 30 * 24 * time.Hour
	defaultProfileRetention = 365 * 24 * time.Hour
	defaultMaxAttempts      = 3
	defaultMaxBytes         = MaxUploadBytes
	defaultOCRLangs         = "eng+fra+por"
	// defaultOCRTimeout caps each rasterize and each Tesseract call. The
	// CLI does not pass a deadline, so the worker has to impose one.
	defaultOCRTimeout = 30 * time.Second
	// defaultExtractTimeout bounds the pure-Go text layer. A pathological
	// content stream still has to finish or the worker moves on.
	defaultExtractTimeout = 5 * time.Second
)

// ErrNotFound means Retry was asked for an id this worker has never accepted.
// The id is not part of the error: the caller already has it.
var ErrNotFound = errors.New("ingest: unknown upload")

var errOpaqueID = errors.New("ingest: upload id must be an opaque token")

// idRe refuses ids that could themselves be a name or an email. The id is
// the one caller string written to logs, so it has to stay an opaque token.
var idRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$`)

// Upload is one CV file plus the Toast origin. There is no file-name field:
// names often contain the candidate.
type Upload struct {
	ID     string
	Bytes  []byte
	Origin source.Origin
}

// Result is the pipeline outcome. Parsed is personal data. LogEvent is the
// separate struct that is safe to log, and it cannot carry Parsed.
type Result struct {
	UploadID    string
	State       state.State
	History     []state.State
	Reason      state.Reason
	RootReason  state.Reason
	Attempts    int
	Retryable   bool
	Parsed      parse.CV
	Mapping     source.Mapping
	DuplicateOf string
}

// TextExtractor reads a PDF text layer. A generic error is a transient
// extract_failed. extract.ErrUnreadable is a corrupt file. Both stay
// retryable until the attempt cap, in case a transfer truncated the bytes.
type TextExtractor interface {
	ExtractText(data []byte) (string, error)
}

// Parser maps text onto fields. The bool is false when no identity was found.
type Parser interface {
	Parse(text string) (parse.CV, bool)
}

// Options configures a worker. Zero values select the defaults: pure-Go PDF
// text, local Tesseract, the rules parser, and in-memory dedupe, sink,
// queue and retention.
type Options struct {
	Now              func() time.Time
	RawRetention     time.Duration
	ProfileRetention time.Duration
	MaxAttempts      int
	MaxBytes         int
	OCRLangs         string
	// OCRTimeout bounds pdftoppm and each Tesseract invocation. Zero
	// selects defaultOCRTimeout. A caller deadline that is sooner still wins.
	OCRTimeout time.Duration
	// ExtractTimeout bounds PDF text extraction. Zero selects
	// defaultExtractTimeout.
	ExtractTimeout time.Duration
	OCR            ocr.Engine
	Extractor      TextExtractor
	Parser         Parser
	Deduper        dedupe.Hook
	Sink           source.Sink
	Logger         Logger
	Retention      privacy.Hook
	Queue          *errqueue.Queue
}

// Worker runs the state machine. Concurrent calls are safe. They share one
// lock, including while OCR runs, so two uploads cannot interleave transitions.
type Worker struct {
	mu             sync.Mutex
	clock          func() time.Time
	rawTTL         time.Duration
	profileTTL     time.Duration
	maxAttempts    int
	maxBytes       int
	ocrTimeout     time.Duration
	extractTimeout time.Duration
	ocrLangs       string
	ocr            ocr.Engine
	extractor      TextExtractor
	parser         Parser
	deduper        dedupe.Hook
	sink           source.Sink
	logger         Logger
	retention      privacy.Hook
	queue          *errqueue.Queue
	docs           map[string]*document
	raw            map[string][]byte
}

// New builds a worker. Nil options select in-memory defaults and local
// Tesseract. The worker does not dial out. The first New in a process
// sweeps leftover ingest temp files from a previous crash.
func New(opt Options) *Worker {
	sweepTempsOnce()
	w := &Worker{
		clock:          opt.Now,
		rawTTL:         opt.RawRetention,
		profileTTL:     opt.ProfileRetention,
		maxAttempts:    opt.MaxAttempts,
		maxBytes:       opt.MaxBytes,
		ocrTimeout:     opt.OCRTimeout,
		extractTimeout: opt.ExtractTimeout,
		ocrLangs:       opt.OCRLangs,
		ocr:            opt.OCR,
		extractor:      opt.Extractor,
		parser:         opt.Parser,
		deduper:        opt.Deduper,
		sink:           opt.Sink,
		logger:         opt.Logger,
		retention:      opt.Retention,
		queue:          opt.Queue,
		docs:           map[string]*document{},
		raw:            map[string][]byte{},
	}
	if w.clock == nil {
		w.clock = time.Now
	}
	if w.rawTTL <= 0 {
		w.rawTTL = defaultRawRetention
	}
	if w.profileTTL <= 0 {
		w.profileTTL = defaultProfileRetention
	}
	if w.maxAttempts <= 0 {
		w.maxAttempts = defaultMaxAttempts
	}
	if w.maxBytes <= 0 {
		w.maxBytes = defaultMaxBytes
	}
	if w.ocrTimeout <= 0 {
		w.ocrTimeout = defaultOCRTimeout
	}
	if w.extractTimeout <= 0 {
		w.extractTimeout = defaultExtractTimeout
	}
	if w.ocrLangs == "" {
		w.ocrLangs = defaultOCRLangs
	}
	if w.ocr == nil {
		w.ocr = ocr.Tesseract{Langs: w.ocrLangs}
	}
	if w.extractor == nil {
		w.extractor = extract.PDF{}
	}
	if w.parser == nil {
		w.parser = parse.Rules{}
	}
	if w.deduper == nil {
		w.deduper = dedupe.NewMemory()
	}
	if w.sink == nil {
		w.sink = source.NewMemory()
	}
	if w.logger == nil {
		w.logger = NopLogger{}
	}
	if w.retention == nil {
		w.retention = privacy.NewMemory()
	}
	if w.queue == nil {
		w.queue = errqueue.New()
	}
	return w
}

func idOK(id string) bool {
	return idRe.MatchString(id)
}
