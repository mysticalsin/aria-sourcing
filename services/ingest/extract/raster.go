package extract

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

// RasterPDF renders up to five pages of a text-less PDF to PNG using
// pdftoppm (Poppler, free). The PDF is written under a private temp name,
// never under the upload's original file name. A missing binary is an error
// the worker maps to ocr_unavailable.
func RasterPDF(ctx context.Context, pdf []byte) ([][]byte, error) {
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "ingest-pdf-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	in := filepath.Join(dir, "in.pdf")
	if err := os.WriteFile(in, pdf, 0o600); err != nil {
		return nil, err
	}
	prefix := filepath.Join(dir, "page")
	cmd := exec.CommandContext(ctx, "pdftoppm", "-png", "-r", "150", "-f", "1", "-l", "5", in, prefix)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	matches, err := filepath.Glob(filepath.Join(dir, "page*.png"))
	if err != nil {
		return nil, err
	}
	if len(matches) == 0 {
		return nil, errors.New("pdftoppm: no pages")
	}
	sort.Strings(matches)
	pages := make([][]byte, 0, len(matches))
	for _, name := range matches {
		b, err := os.ReadFile(name)
		if err != nil {
			return nil, err
		}
		pages = append(pages, b)
	}
	return pages, nil
}
