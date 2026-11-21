package main

import (
	"os"

	"github.com/mysticalsin/aria-sourcing/services/ingest/extract"
)

func main() {
	bytes := extract.BuildTextPDF([]string{
		"Name: Casey Example",
		"Email: casey.example@example.test",
		"Phone: +33 1 99 00 11 22",
		"Location: Lyon, France",
		"Skills: Go, PostgreSQL",
		"Languages: English, French",
		"Experience:",
		"2022-2024 | Recruiter | Example Consulting",
	})
	if err := os.WriteFile(os.Args[1], bytes, 0o644); err != nil {
		os.Exit(1)
	}
}
