package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

func TestGenerateThenAudit(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "run.json")
	js := filepath.Join(dir, "report.json")
	md := filepath.Join(dir, "report.md")
	if code := run([]string{"generate", "--seed", "1", "--n", "40", "--cutoff", "10", "--out", in}, io.Discard, io.Discard); code != 0 {
		t.Fatalf("generate exit %d", code)
	}
	again := filepath.Join(dir, "run-again.json")
	if code := run([]string{"generate", "--seed", "1", "--n", "40", "--cutoff", "10", "--out", again}, io.Discard, io.Discard); code != 0 {
		t.Fatalf("second generate exit %d", code)
	}
	first, err := os.ReadFile(in)
	if err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(again)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("generate is not deterministic")
	}
	var stderr bytes.Buffer
	if code := run([]string{"audit", "--in", in, "--json-out", js, "--md-out", md}, io.Discard, &stderr); code != 0 {
		t.Fatalf("audit exit %d: %s", code, stderr.String())
	}
	raw, err := os.ReadFile(js)
	if err != nil {
		t.Fatal(err)
	}
	var rep fairness.Report
	if err := json.Unmarshal(raw, &rep); err != nil {
		t.Fatal(err)
	}
	switch rep.Verdict {
	case fairness.VerdictInsufficient, fairness.VerdictPass, fairness.VerdictWarn, fairness.VerdictFail:
	default:
		t.Fatalf("verdict %q", rep.Verdict)
	}
	if rep.AutoReject || !rep.HumanDecisionRequired {
		t.Fatalf("autoReject=%v human=%v", rep.AutoReject, rep.HumanDecisionRequired)
	}
	if rep.Disclaimer != fairness.Disclaimer {
		t.Fatal(rep.Disclaimer)
	}
	text, err := os.ReadFile(md)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), "does not certify") || !strings.Contains(string(text), "no auto-reject") {
		t.Fatalf("markdown=%s", text)
	}
}

func TestRejectsUnknownCommand(t *testing.T) {
	var stderr bytes.Buffer
	if code := run([]string{"drop-candidates"}, io.Discard, &stderr); code == 0 {
		t.Fatal("unknown command exited 0")
	}
}

func TestUsageFails(t *testing.T) {
	if code := run(nil, io.Discard, io.Discard); code == 0 {
		t.Fatal("missing command exited 0")
	}
}

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
		for _, banned := range []string{".Skip" + "(", ".Skipf" + "(", ".SkipNow" + "("} {
			if strings.Contains(string(body), banned) {
				t.Fatalf("%s contains %s", e.Name(), banned)
			}
		}
	}
}
