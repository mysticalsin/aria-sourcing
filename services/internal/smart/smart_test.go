package smart_test

import (
	"context"
	"errors"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/smart"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func TestImportExportRoundTripUsesCanonicalKeys(t *testing.T) {
	f := smart.NewFake()
	ctx := context.Background()
	in := smart.Record{
		NeedID:      "need-1001",
		CandidateID: "cand-2002",
		Stage:       stage.ToRate,
		Email:       "Mina.Ortega@People.example.test",
		Name:        "Mina Ortega",
	}
	got, err := f.ImportCopy(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if got.Email != "mina.ortega@people.example.test" || got.Stage != stage.ToRate {
		t.Fatalf("stored = %+v", got)
	}
	out, err := f.ExportCopy(ctx, "need-1001", "cand-2002")
	if err != nil || out != got {
		t.Fatalf("export = %+v %v", out, err)
	}
}

func TestImportRejectsLabelsURLsAndRealMail(t *testing.T) {
	f := smart.NewFake()
	ctx := context.Background()
	base := smart.Record{
		NeedID: "need-1001", CandidateID: "cand-2002", Stage: stage.ToAssess,
		Email: "mina.ortega@people.example.test", Name: "Mina Ortega",
	}
	cases := []smart.Record{
		{NeedID: base.NeedID, CandidateID: base.CandidateID, Stage: "To Assess", Email: base.Email, Name: base.Name},
		{NeedID: base.NeedID, CandidateID: base.CandidateID, Stage: base.Stage, Email: base.Email, Name: "see https://arp.mantu.com/SMARTX/"},
		{NeedID: "http://need", CandidateID: base.CandidateID, Stage: base.Stage, Email: base.Email, Name: base.Name},
		{NeedID: base.NeedID, CandidateID: base.CandidateID, Stage: base.Stage, Email: "mina@gmail.com", Name: base.Name},
		{NeedID: base.NeedID, CandidateID: base.CandidateID, Stage: stage.Hired, Email: base.Email, Name: "playwright export"},
	}
	for _, in := range cases {
		if _, err := f.ImportCopy(ctx, in); err == nil {
			t.Fatalf("accepted %+v", in)
		}
	}
	if _, err := f.ExportCopy(ctx, base.NeedID, base.CandidateID); !errors.Is(err, smart.ErrNotFound) {
		t.Fatal(err)
	}
}

func TestImportedHiredIsOnlyACopy(t *testing.T) {
	f := smart.NewFake()
	_, err := f.ImportCopy(context.Background(), smart.Record{
		NeedID: "need-1001", CandidateID: "cand-2002", Stage: stage.Hired,
		Email: "mina.ortega@people.example.test", Name: "Mina Ortega",
	})
	if err != nil {
		t.Fatal(err)
	}
}
