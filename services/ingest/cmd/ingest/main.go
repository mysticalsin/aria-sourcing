// Command ingest reads one CV and prints a status line.
//
// The status line has the state, the reason code and the UTM fields. It
// does not include the parsed name, contact, skills or the file bytes.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
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
	body, err := os.ReadFile(*file)
	if err != nil {
		fmt.Fprintln(stderr, "cannot read file")
		return 1
	}
	uploadID := *id
	if uploadID == "" {
		uploadID = newID()
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
	enc := json.NewEncoder(stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(st); err != nil {
		fmt.Fprintln(stderr, "cannot write status")
		return 1
	}
	if res.State == state.ErrorQueue {
		return 2
	}
	return 0
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "upload"
	}
	return hex.EncodeToString(b[:])
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
