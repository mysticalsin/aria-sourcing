package fairness_test

import (
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestNoTestsAreSkipped(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		body, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		text := string(body)
		for _, banned := range skipCalls() {
			if strings.Contains(text, banned) {
				t.Fatalf("%s contains %s", e.Name(), banned)
			}
		}
	}
}

func skipCalls() []string {
	return []string{".Skip" + "(", ".Skipf" + "(", ".SkipNow" + "("}
}

func TestLibraryDoesNotDialTheNetwork(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range f.Imports {
			path, err := strconv.Unquote(imp.Path.Value)
			if err != nil {
				t.Fatal(err)
			}
			switch path {
			case "net", "net/http", "net/http/httptest":
				t.Fatalf("%s imports %s", name, path)
			}
		}
	}
}
