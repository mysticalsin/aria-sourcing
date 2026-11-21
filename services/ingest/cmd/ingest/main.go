// Command ingest reads one CV and prints a status line.
//
// The status line has the state, the reason code and the UTM fields. It
// does not include the parsed name, contact, skills or the file bytes.
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/ingest"
	"github.com/mysticalsin/aria-sourcing/services/ingest/source"
	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

type status struct {
	UploadID    string `json:"upload_id"`
	State       string `json:"state"`
	Reason      string `json:"reason,omitempty"`
	RootReason  string `json:"root_reason,omitempty"`
	Attempts    int    `json:"attempts"`
	UTMSource   string `json:"utm_source,omitempty"`
	UTMMedium   string `json:"utm_medium,omitempty"`
	UTMCampaign string `json:"utm_campaign,omitempty"`
	UTMContent  string `json:"utm_content,omitempty"`
	OdooSource  string `json:"odoo_source,omitempty"`
	Stage       string `json:"stage,omitempty"`
	Duplicate   bool   `json:"duplicate"`
	DuplicateOf string `json:"duplicate_of,omitempty"`
}

func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("ingest", flag.ContinueOnError)
	fs.SetOutput(stderr)
	file := fs.String("file", "", "path to a CV (pdf, png, or jpeg)")
	cvSource := fs.String("cv-source", "", "Toast CV source slug")
	jobBoard := fs.String("job-board", "", "job board slug, if the recruiter named one")
	folder := fs.String("folder", "", "destination folder: holding, communities, country, cv-source, need")
	folderValue := fs.String("folder-value", "", "slug for the folder (country code, community, need id)")
	docType := fs.String("doc-type", "", "cv, cover-letter, or other")
	id := fs.String("id", "", "opaque upload id (default: random)")
	langs := fs.String("ocr-langs", "", "tesseract -l value (default: ARIA_OCR_LANGS or eng+fra+por)")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	if *file == "" || *cvSource == "" || *folder == "" {
		fmt.Fprintln(stderr, "usage: ingest -file cv.pdf -cv-source toast-upload -folder holding")
		return 1
	}
	body, err := readLimited(*file, ingest.MaxUploadBytes)
	if err == errTooLarge {
		// Only a UUID or ULID is repeated. Anything else is omitted so the
		// status JSON cannot echo an email or a phone number.
		if writeStatus(stdout, status{
			UploadID: opaqueOrEmpty(*id),
			State:    string(state.ErrorQueue),
			Reason:   string(state.ReasonFileTooLarge),
			Attempts: 1,
		}) != nil {
			fmt.Fprintln(stderr, "cannot write status")
			return 1
		}
		return 2
	}
	if err != nil {
		fmt.Fprintln(stderr, "cannot read file")
		return 1
	}
	uploadID, ok := acceptedID(*id)
	if !ok {
		fmt.Fprintln(stderr, "upload id must be a UUID or ULID")
		return 1
	}
	ocrLangs := *langs
	if ocrLangs == "" {
		ocrLangs = os.Getenv("ARIA_OCR_LANGS")
	}
	w := ingest.New(ingest.Options{
		OCRLangs:         ocrLangs,
		RawRetention:     days(os.Getenv("ARIA_CV_RAW_RETENTION_DAYS"), 30),
		ProfileRetention: days(os.Getenv("ARIA_CV_PROFILE_RETENTION_DAYS"), 365),
	})
	res, err := w.Ingest(context.Background(), ingest.Upload{
		ID:    uploadID,
		Bytes: body,
		Origin: source.Origin{
			CVSource:    *cvSource,
			JobBoard:    *jobBoard,
			Folder:      *folder,
			FolderValue: *folderValue,
			DocType:     *docType,
		},
	})
	if err != nil {
		fmt.Fprintln(stderr, "ingest rejected the upload")
		return 1
	}
	st := status{
		UploadID:    res.UploadID,
		State:       string(res.State),
		Reason:      string(res.Reason),
		RootReason:  string(res.RootReason),
		Attempts:    res.Attempts,
		UTMSource:   res.Mapping.UTM.Source,
		UTMMedium:   res.Mapping.UTM.Medium,
		UTMCampaign: res.Mapping.UTM.Campaign,
		UTMContent:  res.Mapping.UTM.Content,
		OdooSource:  res.Mapping.OdooSource,
		Duplicate:   res.DuplicateOf != "",
		DuplicateOf: res.DuplicateOf,
	}
	if res.State == state.ReadyForToRate {
		st.Stage = res.Mapping.Stage
	}
	if err := writeStatus(stdout, st); err != nil {
		fmt.Fprintln(stderr, "cannot write status")
		return 1
	}
	if res.State == state.ErrorQueue {
		return 2
	}
	return 0
}

var errTooLarge = errors.New("file_too_large")

var (
	uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	ulidRe = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
)

func opaqueID(id string) bool {
	if uuidRe.MatchString(id) {
		return true
	}
	return ulidRe.MatchString(strings.ToUpper(id))
}

// opaqueOrEmpty returns id only when it is a UUID or ULID. Raw input is
// never copied into a status line.
func opaqueOrEmpty(id string) string {
	if opaqueID(id) {
		return id
	}
	return ""
}

// acceptedID returns a UUID or ULID. An empty id becomes a new UUID. Any
// other value is refused without being returned.
func acceptedID(id string) (string, bool) {
	if id == "" {
		return newID(), true
	}
	if opaqueID(id) {
		return id, true
	}
	return "", false
}

// readLimited stats the file and then reads at most max bytes. A file
// larger than max is refused without loading it.
func readLimited(path string, max int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > int64(max) {
		return nil, errTooLarge
	}
	body, err := io.ReadAll(io.LimitReader(f, int64(max)+1))
	if err != nil {
		return nil, err
	}
	if len(body) > max {
		return nil, errTooLarge
	}
	return body, nil
}

func writeStatus(w io.Writer, st status) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc.Encode(st)
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000-0000-4000-8000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func days(raw string, fallback int) time.Duration {
	if raw == "" {
		return time.Duration(fallback) * 24 * time.Hour
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * 24 * time.Hour
	}
	return time.Duration(n) * 24 * time.Hour
}
