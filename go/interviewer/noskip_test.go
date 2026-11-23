package interviewer_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Forge check: no-skip gate. The hand-off suite must not skip, hide behind
// testing.Short, or carry a URL literal that could be dialed by accident.

func TestNoSkipGate(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller")
	}
	dir := filepath.Dir(file)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	banned := []string{
		"t.Ski" + "p(",
		"t.Ski" + "pf(",
		"t.Ski" + "pNow(",
		"testing.Sho" + "rt(",
		"//go:build ign" + "ore",
		"// +build ign" + "ore",
		":" + "//",
	}
	required := []string{
		"property_test.go",
		"noskip_test.go",
		"spec_boundary_test.go",
		"timeout_infra_test.go",
	}
	found := map[string]bool{}
	testFiles := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, "_test.go") {
			continue
		}
		testFiles++
		found[name] = true
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		text := string(body)
		for _, needle := range banned {
			if strings.Contains(text, needle) {
				t.Errorf("%s contains banned %q", name, needle)
			}
		}
	}
	if testFiles < len(required) {
		t.Fatalf("test files %d", testFiles)
	}
	for _, name := range required {
		if !found[name] {
			t.Errorf("missing forge file %s", name)
		}
	}
}
