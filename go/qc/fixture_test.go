package qc_test

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

type fixture struct {
	Name       string   `json:"name"`
	Threshold  float64  `json:"threshold"`
	WantStatus string   `json:"wantStatus"`
	WantScore  float64  `json:"wantScore"`
	WantFailed []string `json:"wantFailed"`
	Input      qc.Input `json:"input"`
}

func TestFixtures(t *testing.T) {
	paths, err := filepath.Glob("testdata/*.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no fixtures")
	}
	covered := map[string]bool{}
	seen := map[string]bool{}
	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			body, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var fx fixture
			if err := json.Unmarshal(body, &fx); err != nil {
				t.Fatal(err)
			}
			if seen[fx.Name] {
				t.Fatalf("duplicate fixture %s", fx.Name)
			}
			seen[fx.Name] = true
			v, err := qc.Evaluate(fx.Input, fx.Threshold)
			if err != nil {
				t.Fatal(err)
			}
			if string(v.Status()) != fx.WantStatus {
				t.Fatalf("status %s want %s reasons %#v", v.Status(), fx.WantStatus, v.Reasons())
			}
			if v.QCVersion() != "qc.v1" {
				t.Fatal(v.QCVersion())
			}
			got := int(math.Round(v.Score() * 10000))
			want := int(math.Round(fx.WantScore * 10000))
			if got != want {
				t.Fatalf("basis %d want %d (score %v)", got, want, v.Score())
			}
			assertReasons(t, v, fx.WantFailed)
			for _, id := range fx.WantFailed {
				covered[id] = true
			}
		})
	}
	for _, id := range []string{
		qc.CheckGrounding,
		qc.CheckProtected,
		qc.CheckOptOut,
		qc.CheckLength,
		qc.CheckPlaceholder,
		qc.CheckPromises,
		qc.CheckLanguage,
	} {
		if !covered[id] {
			t.Errorf("no fixture fails %s", id)
		}
	}
}
