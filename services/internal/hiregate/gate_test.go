package hiregate_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/dna"
	"github.com/mysticalsin/aria-sourcing/services/internal/hiregate"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func TestIssueRefusesUnlessContractAndDNA(t *testing.T) {
	ctx := context.Background()
	app := hiregate.Snapshot{
		AriaID: "cand-1", Stage: stage.ToHire,
		SmartCandidateID: "cand-2002", SmartNeedID: "need-1001",
	}
	d := dna.NewFake()
	_, err := hiregate.Issue(ctx, app, d)
	if !errors.Is(err, hiregate.ErrHireRefused) || !errors.Is(err, hiregate.ErrContractNotAttached) || !errors.Is(err, hiregate.ErrDNANotIntegrated) {
		t.Fatal(err)
	}
	app.ContractAttached = true
	_, err = hiregate.Issue(ctx, app, d)
	if !errors.Is(err, hiregate.ErrDNANotIntegrated) || errors.Is(err, hiregate.ErrContractNotAttached) {
		t.Fatal(err)
	}
	app.ContractAttached = false
	d.Seed("cand-2002", "need-1001", true)
	_, err = hiregate.Issue(ctx, app, d)
	if !errors.Is(err, hiregate.ErrContractNotAttached) || errors.Is(err, hiregate.ErrDNANotIntegrated) {
		t.Fatal(err)
	}
	app.ContractAttached = true
	cl, err := hiregate.Issue(ctx, app, d)
	if err != nil || !cl.ValidFor("cand-1") || cl.ValidFor("other") {
		t.Fatalf("clearance = %+v err=%v", cl, err)
	}
	var zero hiregate.Clearance
	if zero.ValidFor("cand-1") || zero.CandidateID() != "" {
		t.Fatal("zero clearance must not pass")
	}
}

func TestIssueRefusesWrongStageAndDNAFailure(t *testing.T) {
	d := dna.NewFake()
	d.Seed("cand-2002", "need-1001", true)
	d.SetError(errors.New("dna unavailable canary-not-a-credential"))
	_, err := hiregate.Issue(context.Background(), hiregate.Snapshot{
		AriaID: "cand-1", Stage: stage.ToHire, ContractAttached: true,
		SmartCandidateID: "cand-2002", SmartNeedID: "need-1001",
	}, d)
	if !errors.Is(err, hiregate.ErrDNANotIntegrated) || (err != nil && strings.Contains(err.Error(), "canary-not-a-credential")) {
		t.Fatal(err)
	}
	d.SetError(nil)
	_, err = hiregate.Issue(context.Background(), hiregate.Snapshot{
		AriaID: "cand-1", Stage: stage.ToAssess, ContractAttached: true,
		SmartCandidateID: "cand-2002", SmartNeedID: "need-1001",
	}, d)
	if !errors.Is(err, stage.ErrTransition) {
		t.Fatal(err)
	}
}
