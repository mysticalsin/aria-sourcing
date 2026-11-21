package qc_test

import (
	"errors"
	"strconv"
	"testing"

	"github.com/mysticalsin/aria-sourcing/go/qc"
)

func TestThresholdFrom(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{"unset", "", "0.9", true},
		{"blank", "   ", "0.9", true},
		{"default literal", "0.9", "0.9", true},
		{"padded", "  0.90  ", "0.90", true},
		{"one", "1", "1", true},
		{"one decimal", "1.00", "1.00", true},
		{"zero", "0", "0", true},
		{"zero decimal", "0.0", "0.0", true},
		{"half", "0.5", "0.5", true},
		{"newline trimmed", "0.25\n", "0.25", true},
		{"exponent", "1e-1", "", false},
		{"plus", "+0.9", "", false},
		{"bare fraction", ".9", "", false},
		{"trailing dot", "1.", "", false},
		{"padded integer", "00.5", "", false},
		{"over", "1.1", "", false},
		{"two", "2", "", false},
		{"negative", "-0.1", "", false},
		{"negative zero", "-0", "", false},
		{"word", "high", "", false},
		{"empty fraction", "0.", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := qc.ThresholdFrom(func(key string) string {
				if key != qc.EnvQCPassThreshold {
					return "ignored"
				}
				return tc.raw
			})
			if !tc.ok {
				if !errors.Is(err, qc.ErrThreshold) {
					t.Fatalf("err %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			want, err := strconv.ParseFloat(tc.want, 64)
			if err != nil {
				t.Fatal(err)
			}
			if got != want {
				t.Fatalf("got %v want %v", got, want)
			}
		})
	}
	if _, err := qc.ThresholdFrom(nil); !errors.Is(err, qc.ErrThreshold) {
		t.Fatal(err)
	}
}

func TestLoadThreshold(t *testing.T) {
	t.Setenv(qc.EnvQCPassThreshold, "")
	got, err := qc.LoadThreshold()
	if err != nil || got != qc.DefaultThreshold {
		t.Fatalf("got %v %v", got, err)
	}
	t.Setenv(qc.EnvQCPassThreshold, "0.5")
	got, err = qc.LoadThreshold()
	if err != nil || got != 0.5 {
		t.Fatalf("got %v %v", got, err)
	}
	t.Setenv(qc.EnvQCPassThreshold, "nope")
	if _, err := qc.LoadThreshold(); !errors.Is(err, qc.ErrThreshold) {
		t.Fatal(err)
	}
}

func TestDefaultThreshold(t *testing.T) {
	if qc.DefaultThreshold != 0.9 {
		t.Fatalf("default %v", qc.DefaultThreshold)
	}
	if qc.EnvQCPassThreshold != "ARIA_QC_PASS_THRESHOLD" {
		t.Fatal(qc.EnvQCPassThreshold)
	}
}
