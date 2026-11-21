package qc_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestForgeIsolation(t *testing.T) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(info os.FileInfo) bool {
		name := info.Name()
		return strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, "_test.go")
	}, parser.ImportsOnly)
	if err != nil {
		t.Fatal(err)
	}
	if len(pkgs) != 1 {
		t.Fatalf("packages %d", len(pkgs))
	}
	for _, pkg := range pkgs {
		for name, file := range pkg.Files {
			base := filepath.Base(name)
			for _, imp := range file.Imports {
				path := strings.Trim(imp.Path.Value, `"`)
				if imp.Name != nil && (imp.Name.Name == "." || imp.Name.Name == "_") {
					t.Errorf("%s uses a dot or blank import %s", base, path)
				}
				if forbiddenImport(path) || (path == "os" && base != "threshold.go") {
					t.Errorf("%s imports %s", base, path)
				}
			}
		}
	}
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		body, err := os.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		text := string(body)
		for _, needle := range []string{"http.Get", "http.Post", "http.NewRequest", ".Dial(", ".Listen(", "exec.Command"} {
			if strings.Contains(text, needle) {
				t.Errorf("%s contains %s", entry.Name(), needle)
			}
		}
	}
}

func forbiddenImport(path string) bool {
	switch path {
	case "net", "unsafe", "os/exec", "net/http", "net/http/httptest":
		return true
	}
	if strings.HasPrefix(path, "net/") || strings.HasPrefix(path, "golang.org/x/net") {
		return true
	}
	lower := strings.ToLower(path)
	for _, piece := range []string{"ledger", "odoo", "approval", "heyreach", "channels"} {
		if strings.Contains(lower, piece) {
			return true
		}
	}
	return false
}

func TestTestsDoNotSkip(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	skipCall := "t.Skip"
	xfail := "XF" + "ail"
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		body, err := os.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		text := string(body)
		if strings.Contains(text, skipCall+"(") || strings.Contains(text, skipCall+"f(") || strings.Contains(text, skipCall+"Now(") || strings.Contains(text, xfail) {
			t.Fatalf("%s skips or xfails", entry.Name())
		}
	}
}

func TestExternalTestPackage(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		body, err := os.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(body), "package qc\n") {
			t.Fatalf("%s is not package qc_test", entry.Name())
		}
	}
}

func TestModuleHasNoDependencies(t *testing.T) {
	root := moduleRoot(t)
	body, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	if !strings.Contains(text, "module github.com/mysticalsin/aria-sourcing\n") {
		t.Fatalf("module path drifted:\n%s", text)
	}
	if !strings.Contains(text, "\ngo 1.22\n") {
		t.Fatalf("go version drifted:\n%s", text)
	}
	if strings.Contains(text, "require") {
		t.Fatalf("qc module must not require dependencies:\n%s", text)
	}
}

func TestCIRunsQCPackage(t *testing.T) {
	root := moduleRoot(t)
	body, err := os.ReadFile(filepath.Join(root, ".github", "workflows", "go-qc.yml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	if !strings.Contains(text, "go test ./go/qc/...") {
		t.Fatalf("workflow does not run the qc tests:\n%s", text)
	}
	if strings.Contains(text, "continue-on-error: true") {
		t.Fatal("qc tests must not be allowed to fail")
	}
}

func TestLimitDocs(t *testing.T) {
	body, err := os.ReadFile("limits.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, url := range []string{
		"https://www.linkedin.com/help/linkedin/answer/a411986/inmail-character-limits",
		"https://www.heyreach.io/blog/campaign-api",
		"https://help.heyreach.io/en/articles/10493916-what-can-be-automated-in-heyreach-sequence",
	} {
		if !strings.Contains(text, url) {
			t.Errorf("limits.go is missing %s", url)
		}
	}
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found")
		}
		dir = parent
	}
}
