package qc_test

import (
	"math"
	"math/rand"
	"reflect"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

func TestPropertyRandomInputs(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 200; i++ {
		in := qc.Input{
			Draft: qc.Draft{
				Channel:  randString(rng),
				Subject:  randString(rng),
				Body:     randString(rng),
				Language: randString(rng),
				Claims: []qc.Claim{{
					Text:  randString(rng),
					Scope: randString(rng),
				}},
			},
			Candidate: qc.Candidate{
				Language: randString(rng),
				Facts:    []qc.Fact{{Scope: randString(rng), Text: randString(rng), Value: randString(rng)}},
			},
			Need: qc.Need{
				Facts: []qc.Fact{{Scope: randString(rng), Attribute: randString(rng), Text: randString(rng), Value: randString(rng)}},
			},
		}
		assertStable(t, in, 0.9)
	}
}

func assertStable(t *testing.T, in qc.Input, threshold float64) {
	t.Helper()
	defer func() {
		if rec := recover(); rec != nil {
			t.Fatalf("panic: %v", rec)
		}
	}()
	first, err := qc.Evaluate(in, threshold)
	if err != nil {
		t.Fatal(err)
	}
	second, err := qc.Evaluate(in, threshold)
	if err != nil {
		t.Fatal(err)
	}
	if first.Score() < 0 || first.Score() > 1 || math.IsNaN(first.Score()) || math.IsInf(first.Score(), 0) {
		t.Fatalf("score %v", first.Score())
	}
	if first.QCVersion() != "qc.v1" {
		t.Fatalf("version %s", first.QCVersion())
	}
	if first.Status() != qc.StatusPass && first.Status() != qc.StatusFail {
		t.Fatalf("status %q", first.Status())
	}
	if !reflect.DeepEqual(project(first), project(second)) {
		t.Fatal("not deterministic")
	}
	reasons := first.Reasons()
	if len(reasons) != 7 {
		t.Fatalf("reasons %d", len(reasons))
	}
	all := true
	for _, reason := range reasons {
		if reason.Detail == "" {
			t.Fatal("empty detail")
		}
		if !reason.Pass {
			all = false
		}
	}
	if first.Status() == qc.StatusPass {
		if !all || first.Score() != 1 || first.Score() < threshold {
			t.Fatalf("pass invariant score %v all %v", first.Score(), all)
		}
	}
	if all && first.Score() == 1 && first.Status() != qc.StatusPass {
		t.Fatal("full score did not pass")
	}
}

func project(v qc.Verdict) any {
	return struct {
		status  qc.Status
		score   float64
		version string
		reasons []qc.Reason
	}{v.Status(), v.Score(), v.QCVersion(), v.Reasons()}
}

func randString(rng *rand.Rand) string {
	n := rng.Intn(80)
	buf := make([]byte, n)
	for i := range buf {
		buf[i] = byte(rng.Intn(256))
	}
	return string(buf)
}
