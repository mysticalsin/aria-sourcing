package ingest_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/ingest"
)

func TestSweepTempsRemovesOnlyIngestFiles(t *testing.T) {
	dir := t.TempDir()
	ocr := filepath.Join(dir, "ingest-ocr-stale.png")
	pdfDir := filepath.Join(dir, "ingest-pdf-stale")
	keep := filepath.Join(dir, "keep.txt")
	if err := os.WriteFile(ocr, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(pdfDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pdfDir, "in.pdf"), []byte("%PDF"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keep, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if n := ingest.SweepTemps(dir); n != 2 {
		t.Fatalf("removed %d", n)
	}
	if _, err := os.Stat(ocr); !os.IsNotExist(err) {
		t.Fatal("ocr temp left behind")
	}
	if _, err := os.Stat(pdfDir); !os.IsNotExist(err) {
		t.Fatal("pdf temp left behind")
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal(err)
	}
}
