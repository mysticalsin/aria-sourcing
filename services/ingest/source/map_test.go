package source

import (
	"context"
	"testing"
)

func TestMapToastFields(t *testing.T) {
	cases := []struct {
		name     string
		in       Origin
		source   string
		medium   string
		campaign string
		content  string
		odoo     string
	}{
		{
			name:     "job board and need folder",
			in:       Origin{CVSource: "Toast-Upload", JobBoard: "Indeed", Folder: "need", FolderValue: "900001"},
			source:   "indeed",
			medium:   "job-board",
			campaign: "need:900001",
			content:  "cv",
			odoo:     "Candidate-supplied",
		},
		{
			name:     "folder drop and country",
			in:       Origin{CVSource: "folder", Folder: "country", FolderValue: "FR"},
			source:   "folder",
			medium:   "folder",
			campaign: "country:fr",
			content:  "cv",
			odoo:     "Candidate-supplied",
		},
		{
			name:     "recruiter export holding",
			in:       Origin{CVSource: "recruiter-export", Folder: "holding"},
			source:   "recruiter-export",
			medium:   "recruiter-export",
			campaign: "holding",
			content:  "cv",
			odoo:     "LinkedIn Recruiter CSV",
		},
		{
			name:     "rsc community",
			in:       Origin{CVSource: "rsc-ats", Folder: "communities", FolderValue: "emea-bench"},
			source:   "rsc-ats",
			medium:   "ats",
			campaign: "communities:emea-bench",
			content:  "cv",
			odoo:     "RSC/ATS",
		},
		{
			name:     "application grouped by cv source",
			in:       Origin{CVSource: "job-application", Folder: "cv-source", FolderValue: "referral-desk", DocType: "cover-letter"},
			source:   "job-application",
			medium:   "job-application",
			campaign: "cv-source:referral-desk",
			content:  "cover-letter",
			odoo:     "Job application",
		},
		{
			name:     "referral from a board",
			in:       Origin{CVSource: "referral", JobBoard: "welcome-to-the-jungle", Folder: "holding"},
			source:   "welcome-to-the-jungle",
			medium:   "job-board",
			campaign: "holding",
			content:  "cv",
			odoo:     "Candidate-supplied",
		},
		{
			name:     "candidate portal",
			in:       Origin{CVSource: "candidate-portal", Folder: "country", FolderValue: "BR"},
			source:   "candidate-portal",
			medium:   "cv-upload",
			campaign: "country:br",
			content:  "cv",
			odoo:     "Candidate-supplied",
		},
		{
			name:     "email into holding",
			in:       Origin{CVSource: "email", Folder: "holding"},
			source:   "email",
			medium:   "email",
			campaign: "holding",
			content:  "cv",
			odoo:     "Candidate-supplied",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Map(tc.in)
			if err != nil {
				t.Fatal(err)
			}
			if got.Stage != StageToRate {
				t.Fatalf("stage %s", got.Stage)
			}
			if got.UTM.Source != tc.source || got.UTM.Medium != tc.medium || got.UTM.Campaign != tc.campaign || got.UTM.Content != tc.content {
				t.Fatalf("utm %+v", got.UTM)
			}
			if got.OdooSource != tc.odoo {
				t.Fatalf("odoo source %s", got.OdooSource)
			}
		})
	}
}

func TestMapRejects(t *testing.T) {
	cases := []struct {
		in   Origin
		want error
	}{
		{Origin{CVSource: "linkedin-scrape", Folder: "holding"}, ErrUnsanctioned},
		{Origin{CVSource: "Casey Example", Folder: "holding"}, ErrUnsanctioned},
		{Origin{CVSource: "toast-upload", JobBoard: "phantom", Folder: "holding"}, ErrUnsanctioned},
		{Origin{CVSource: "toast-upload", Folder: "inbox"}, ErrUnknownFolder},
		{Origin{CVSource: "toast-upload", Folder: "need"}, ErrUnknownFolder},
		{Origin{CVSource: "toast-upload", Folder: "need", FolderValue: "jane doe"}, ErrUnknownFolder},
		{Origin{CVSource: "toast-upload", Folder: "country", FolderValue: "a@b.test"}, ErrUnknownFolder},
		{Origin{CVSource: "toast-upload", Folder: "holding", DocType: "contract"}, ErrUnknownDocType},
	}
	for _, tc := range cases {
		_, err := Map(tc.in)
		if err != tc.want {
			t.Fatalf("Map(%+v) err %v want %v", tc.in, err, tc.want)
		}
	}
}

func TestSanitizeDropsFreeText(t *testing.T) {
	got := Sanitize(Origin{
		CVSource:    "Casey Example",
		JobBoard:    "indeed",
		Folder:      "need",
		FolderValue: "casey.sample@example.test",
	})
	if got.CVSource != "" || got.FolderValue != "" {
		t.Fatalf("free text survived: %+v", got)
	}
	if got.JobBoard != "indeed" || got.Folder != "need" {
		t.Fatalf("slugs dropped: %+v", got)
	}
}

func TestMemoryUpsertIsIdempotent(t *testing.T) {
	m := NewMemory()
	rec := Record{IdempotencyKey: IdempotencyKey("up-1"), UploadID: "up-1", Stage: StageToRate, Applicant: Applicant{Email: "a@example.test"}}
	ctx := context.Background()
	if err := m.UpsertSource(ctx, rec); err != nil {
		t.Fatal(err)
	}
	rec.Applicant.Email = "b@example.test"
	if err := m.UpsertSource(ctx, rec); err != nil {
		t.Fatal(err)
	}
	if m.Len() != 1 || m.Calls() != 2 {
		t.Fatalf("len %d calls %d", m.Len(), m.Calls())
	}
	got, ok := m.ByUpload("up-1")
	if !ok || got.Applicant.Email != "b@example.test" {
		t.Fatalf("stored %+v ok %v", got, ok)
	}
	if err := m.EraseApplicant(ctx, "up-1"); err != nil {
		t.Fatal(err)
	}
	got, _ = m.ByUpload("up-1")
	if got.Applicant.Email != "" || got.Stage != StageToRate {
		t.Fatalf("erase %+v", got)
	}
}
