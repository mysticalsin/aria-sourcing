package stage_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func TestStageKeysMatchCrossLayerContract(t *testing.T) {
	const want = "to_rate,to_assess,to_interview,shoot,qm,to_hire,hired,rejected,withdrawn"
	got := strings.Join(stage.Keys(), ",")
	if got != want {
		t.Fatalf("keys = %s, want %s", got, want)
	}
}

func TestDisplayLabelsAreNotKeys(t *testing.T) {
	if stage.Known("To Rate") || stage.Known("Hired") || stage.Known("To Hire") {
		t.Fatal("display labels must not be accepted as keys")
	}
	for _, key := range stage.Keys() {
		label, ok := stage.Label(key)
		if !ok || label == "" || label == key && key != "shoot" && key != "qm" && key != "hired" && key != "rejected" && key != "withdrawn" {
			t.Fatalf("label for %s = %q ok=%v", key, label, ok)
		}
		if _, ok := stage.Sequence(key); !ok {
			t.Fatalf("missing sequence for %s", key)
		}
	}
}

func TestTransitionGuardsAreExplicit(t *testing.T) {
	want := [][2]string{
		{"to_rate", "to_assess"},
		{"to_rate", "rejected"},
		{"to_rate", "withdrawn"},
		{"to_assess", "to_interview"},
		{"to_assess", "rejected"},
		{"to_assess", "withdrawn"},
		{"to_interview", "shoot"},
		{"to_interview", "rejected"},
		{"to_interview", "withdrawn"},
		{"shoot", "qm"},
		{"shoot", "rejected"},
		{"shoot", "withdrawn"},
		{"qm", "to_hire"},
		{"qm", "rejected"},
		{"qm", "withdrawn"},
		{"to_hire", "hired"},
		{"to_hire", "rejected"},
		{"to_hire", "withdrawn"},
	}
	got := stage.Edges()
	if len(got) != len(want) {
		t.Fatalf("edge count = %d, want %d", len(got), len(want))
	}
	allowed := map[[2]string]bool{}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("edge %d = %v, want %v", i, got[i], want[i])
		}
		allowed[want[i]] = true
	}
	keys := stage.Keys()
	for _, from := range keys {
		for _, to := range keys {
			err := stage.Allow(from, to)
			_, ok := allowed[[2]string{from, to}]
			if ok && err != nil {
				t.Fatalf("Allow(%s, %s) = %v, want nil", from, to, err)
			}
			if !ok && !errors.Is(err, stage.ErrTransition) {
				t.Fatalf("Allow(%s, %s) = %v, want transition error", from, to, err)
			}
		}
	}
	// The graph allows the hire edge. The hire gate still refuses it
	// without a contract and a DNA integration report.
	if err := stage.Allow(stage.ToHire, stage.Hired); err != nil {
		t.Fatal(err)
	}
	for _, terminal := range []string{stage.Hired, stage.Rejected, stage.Withdrawn} {
		for _, to := range keys {
			if err := stage.Allow(terminal, to); err == nil {
				t.Fatalf("%s -> %s must stay terminal", terminal, to)
			}
		}
	}
}

func TestUnknownStageIsNotEchoed(t *testing.T) {
	const canary = "canary-not-a-credential"
	err := stage.Allow(stage.ToRate, "not-a-stage "+canary)
	if !errors.Is(err, stage.ErrTransition) {
		t.Fatal(err)
	}
	if strings.Contains(err.Error(), canary) {
		t.Fatalf("error echoed input: %s", err)
	}
}
