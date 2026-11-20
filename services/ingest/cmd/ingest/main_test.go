package main

import (
	"bytes"
	"strings"
	"testing"

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
		"-id", "cli-1",
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

func TestCLICorruptFileExits2(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/bad.pdf"
	if err := osWrite(path, []byte("not a cv SECRETTOKEN")); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code := run([]string{"-file", path, "-cv-source", "folder", "-folder", "holding", "-id", "cli-bad"}, &stdout, &stderr)
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
