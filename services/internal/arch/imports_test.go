package arch_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func TestCoreDoesNotDependOnSmartOrTheNetwork(t *testing.T) {
	root := moduleRoot(t)
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			// services/channels is its own module. Its HTTP client is
			// covered by that module's tests, not by the core walk.
			if path != root {
				if _, statErr := os.Stat(filepath.Join(path, "go.mod")); statErr == nil {
					return filepath.SkipDir
				}
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			t.Errorf("parse %s: %v", path, err)
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		text := string(src)
		if strings.Contains(text, "arp.mantu.com") && rel != "internal/smart/smart.go" {
			t.Errorf("%s mentions the ARP host", rel)
		}
		if rel != "internal/testenv/nonet.go" && (strings.Contains(text, "DefaultClient") || strings.Contains(text, "DefaultTransport") || strings.Contains(text, "net.Dial")) {
			t.Errorf("%s can dial the default network stack", rel)
		}
		for _, imp := range file.Imports {
			imported := strings.Trim(imp.Path.Value, `"`)
			if strings.HasSuffix(imported, "/internal/smart") {
				t.Errorf("%s imports the smart seam", rel)
			}
			if imported == "net/http" && !httpAllowed(rel) {
				t.Errorf("%s imports net/http", rel)
			}
		}
		if rel != "internal/odoo/json2.go" && strings.Contains(text, "NewClient(") {
			t.Errorf("%s constructs the JSON-2 client", rel)
		}
		if rel != "internal/config/config.go" && rel != "internal/odoo/json2.go" && strings.Contains(text, ".Value()") {
			t.Errorf("%s reads a secret value", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func httpAllowed(rel string) bool {
	switch rel {
	case "internal/odoo/json2.go", "internal/api/server.go", "internal/app/app.go", "cmd/aria-services/main.go", "internal/testenv/nonet.go":
		return true
	default:
		return false
	}
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Dir(filepath.Dir(filepath.Dir(file)))
}
