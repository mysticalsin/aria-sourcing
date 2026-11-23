package qc_test

import (
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/qc"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

const specific = "Ada, the example ledger you published in 2024 is the piece I want to talk about, including the hash binding and the audit trail you kept."

func TestSpecificBodyPassesAndGenericBodyFails(t *testing.T) {
	got := qc.Evaluate(specific)
	if !got.Pass || got.Generic || got.RubricScore < qc.MinRubricScore || len(got.Reasons) != 0 {
		t.Fatalf("specific = %+v", got)
	}
	for _, body := range []string{
		"too short",
		"I hope this email finds you well. I came across your profile and wanted to reach out about an exciting opportunity at Northwind.",
		"Just following up on the example role. " + specific,
	} {
		got = qc.Evaluate(body)
		if got.Pass || !got.Generic || got.RubricScore >= qc.MinRubricScore {
			t.Fatalf("generic %q = %+v", body, got)
		}
	}
}
