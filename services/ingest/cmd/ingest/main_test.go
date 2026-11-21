package main

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/ingest"
	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
)

func TestCLIPrintsStatusWithoutCVBody(t *testing.T) {
	const email = "casey.cli@example.test"
	pdf := extract.BuildTextPDF([]string{
		"Name: Casey Example",
		"Email: " + email,
		"Phone: +33 1 99 00 11 22",
		"Location: Lyon, France",
		"Skills: Go, Zorblax",
		"Languages: English",
		"Experience:",
		"2022-2024 | Recruiter | Example Consulting",
	})
	dir := t.TempDir()
	path := dir + "/cv.pdf"
	if err := osWrite(path, pdf); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code := run([]string{
		"-file", path,
		"-cv-source", "toast-upload",
		"-job-board", "indeed",
		"-folder", "need",
		"-folder-value", "900001",
		"-id", "550e8400-e29b-41d4-a716-446655440000",
	}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit %d stderr %s stdout %s", code, stderr.String(), stdout.String())
	}
	out := stdout.String()
	for _, needle := range []string{email, "Casey Example", "Zorblax", "99001122"} {
		if strings.Contains(out, needle) || strings.Contains(stderr.String(), needle) {
			t.Fatalf("CLI leaked %q\nstdout %s\nstderr %s", needle, out, stderr.String())
		}
	}
	for _, want := range []string{`"state":"ready_for_to_rate"`, `"utm_source":"indeed"`, `"utm_campaign":"need:900001"`, `"stage":"to_rate"`} {
		if !strings.Contains(out, want) {
			t.Fatalf("stdout missing %s: %s", want, out)
		}
	}
}

func TestCLIDoesNotReadPastUploadCap(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/big.pdf"
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("SECRETTOKEN"); err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(int64(ingest.MaxUploadBytes) + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()
	var stdout, stderr bytes.Buffer
	code := run([]string{"-file", path, "-cv-source", "toast-upload", "-folder", "holding", "-id", "550e8400-e29b-41d4-a716-446655440000"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit %d stdout %s stderr %s", code, stdout.String(), stderr.String())
	}
	out := stdout.String() + stderr.String()
	if strings.Contains(out, "SECRETTOKEN") {
		t.Fatal("oversized file body was printed")
	}
	if !strings.Contains(stdout.String(), `"reason":"file_too_large"`) {
		t.Fatalf("stdout %s", stdout.String())
	}
}

func TestOversizedFileDoesNotEchoRawID(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/big.pdf"
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(int64(ingest.MaxUploadBytes) + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()
	var stdout, stderr bytes.Buffer
	code := run([]string{
		"-file", path,
		"-cv-source", "toast-upload",
		"-folder", "holding",
		"-id", "casey.sample@example.test",
	}, &stdout, &stderr)
	out := stdout.String() + stderr.String()
	if code == 0 {
		t.Fatal("oversized file was accepted")
	}
	for _, needle := range []string{"casey.sample", "@example.test", "casey.sample@example.test"} {
		if strings.Contains(out, needle) {
			t.Fatalf("status echoed raw id %q\n%s", needle, out)
		}
	}
}

func TestReadLimitedHonorsCap(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/n.bin"
	if err := os.WriteFile(path, bytes.Repeat([]byte("Z"), 64), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := readLimited(path, 8)
	if err != errTooLarge {
		t.Fatalf("err %v len %d", err, len(got))
	}
	if len(got) > 8 {
		t.Fatalf("read %d bytes past the cap", len(got))
	}
}

func TestCLICorruptFileExits2(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/bad.pdf"
	if err := osWrite(path, []byte("not a cv SECRETTOKEN")); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code := run([]string{"-file", path, "-cv-source", "folder", "-folder", "holding", "-id", "550e8400-e29b-41d4-a716-446655440001"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit %d stdout %s", code, stdout.String())
	}
	if !strings.Contains(stdout.String(), `"state":"error_queue"`) {
		t.Fatalf("stdout %s", stdout.String())
	}
	if strings.Contains(stdout.String(), "SECRETTOKEN") || strings.Contains(stderr.String(), "SECRETTOKEN") {
		t.Fatal("corrupt bytes were printed")
	}
}

func osWrite(path string, body []byte) error {
	return writeFile(path, body)
}
