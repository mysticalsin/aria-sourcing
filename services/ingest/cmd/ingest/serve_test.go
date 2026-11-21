package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
)

func TestServeSyntheticCVDoesNotLogTheAddress(t *testing.T) {
	var logs bytes.Buffer
	handler := newCVHandler(&logs)
	body := &bytes.Buffer{}
	form := multipart.NewWriter(body)
	part, err := form.CreateFormFile("file", "casey.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(extract.BuildTextPDF([]string{
		"Name: Casey Example",
		"Email: casey.example@example.test",
		"Phone: +33 1 99 00 11 22",
		"Location: Lyon, France",
		"Skills: Go, PostgreSQL",
		"Languages: English, French",
		"Experience:",
		"2022-2024 | Recruiter | Example Consulting",
	})); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/cv", body)
	req.Header.Set("content-type", form.FormDataContentType())
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Casey Example") {
		t.Fatalf("body %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "casey.example@example.test") {
		t.Fatalf("body %s", rec.Body.String())
	}
	if strings.Contains(logs.String(), "casey.example@example.test") || strings.Contains(logs.String(), "Casey Example") {
		t.Fatalf("log leaked the CV: %s", logs.String())
	}
}
