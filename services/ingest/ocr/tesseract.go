// Package ocr runs a local Tesseract binary. Tesseract is Apache-2.0.
// This package never calls a cloud OCR API.
package ocr

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
)

// Engine recognizes text in a raster image (PNG, JPEG, or TIFF).
// Implementations must not include image bytes or recognized text in errors.
type Engine interface {
	Available() bool
	Recognize(ctx context.Context, image []byte, langs string) (string, error)
}

// Tesseract shells out to the tesseract CLI. Image bytes go to a 0600 temp
// file that is removed before return. Stderr is discarded: it is not a log.
type Tesseract struct {
	// Bin is the executable name. Empty means "tesseract" on PATH.
	Bin string
	// Langs is the default -l value when Recognize is called with an empty
	// language string. Empty means eng.
	Langs string
}

func (t Tesseract) bin() string {
	if t.Bin != "" {
		return t.Bin
	}
	return "tesseract"
}

// Available reports whether the binary is on PATH.
func (t Tesseract) Available() bool {
	_, err := exec.LookPath(t.bin())
	return err == nil
}

// Recognize returns the UTF-8 text of one image.
func (t Tesseract) Recognize(ctx context.Context, image []byte, langs string) (string, error) {
	if len(image) == 0 {
		return "", errors.New("tesseract: empty image")
	}
	if langs == "" {
		langs = t.Langs
	}
	if langs == "" {
		langs = "eng"
	}
	ext := ".png"
	switch {
	case bytes.HasPrefix(image, []byte{0xFF, 0xD8, 0xFF}):
		ext = ".jpg"
	case bytes.HasPrefix(image, []byte("II*\x00")), bytes.HasPrefix(image, []byte("MM\x00*")):
		ext = ".tif"
	}
	f, err := os.CreateTemp("", "ingest-ocr-*"+ext)
	if err != nil {
		return "", errors.New("tesseract: temp file")
	}
	name := f.Name()
	defer os.Remove(name)
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		return "", errors.New("tesseract: temp file")
	}
	if _, err := f.Write(image); err != nil {
		f.Close()
		return "", errors.New("tesseract: temp file")
	}
	if err := f.Close(); err != nil {
		return "", errors.New("tesseract: temp file")
	}

	cmd := exec.CommandContext(ctx, t.bin(), name, "stdout", "-l", langs, "--psm", "6", "--dpi", "150")
	cmd.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1")
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		// The exit status is enough. Stderr is not attached: Tesseract can
		// echo path details, and the text itself must not ride along in an error.
		return "", errors.New("tesseract: failed")
	}
	return strings.TrimSpace(stdout.String()), nil
}
