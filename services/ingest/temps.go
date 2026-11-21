package ingest

import (
	"os"
	"path/filepath"
	"sync"
)

// Temp prefixes owned by this process. A crash can leave them behind;
// startup removes only these names, not the rest of the temp directory.
const (
	tempOCRPrefix = "ingest-ocr-"
	tempPDFPrefix = "ingest-pdf-"
)

var sweepOnce sync.Once

func sweepTempsOnce() {
	sweepOnce.Do(func() {
		SweepTemps(os.TempDir())
	})
}

// SweepTemps removes leftover ingest temp files and directories under dir.
// It returns how many paths were removed.
func SweepTemps(dir string) int {
	n := 0
	for _, prefix := range []string{tempOCRPrefix, tempPDFPrefix} {
		matches, err := filepath.Glob(filepath.Join(dir, prefix+"*"))
		if err != nil {
			continue
		}
		for _, name := range matches {
			if os.RemoveAll(name) == nil {
				n++
			}
		}
	}
	return n
}
