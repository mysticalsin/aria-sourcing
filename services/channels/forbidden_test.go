package channels

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestSourceHasNoDirectSessionAccessMarkers fails when this module grows a
// direct session client. The needles are built by concatenation so this file
// can name the denylist without containing the contiguous literals.
func TestSourceHasNoDirectSessionAccessMarkers(t *testing.T) {
	needles := []string{
		strings.Join([]string{"linked", "in.com"}, ""),
		strings.Join([]string{"voy", "ager"}, ""),
		strings.Join([]string{"li_", "at"}, ""),
		strings.Join([]string{"coo", "kie"}, ""),
		strings.Join([]string{"jsess", "ionid"}, ""),
		strings.Join([]string{"session", "token"}, ""),
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	root := filepath.Dir(file)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		blob, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := strings.ToLower(string(blob))
		for _, needle := range needles {
			if strings.Contains(text, strings.ToLower(needle)) {
				t.Errorf("%s contains %q", filepath.Base(path), needle)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
