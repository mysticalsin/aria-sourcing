package qc

import (
	"errors"
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// EnvQCPassThreshold is the process environment key for the pass threshold.
const EnvQCPassThreshold = "ARIA_QC_PASS_THRESHOLD"

// DefaultThreshold is the pass threshold used when the key is unset or blank.
const DefaultThreshold = 0.9

// ErrThreshold is returned when a threshold is outside [0, 1] or is not a
// plain decimal.
var ErrThreshold = errors.New("qc: invalid threshold")

// 0, 1, 1.0, 0.9, 0.90. No exponent, no leading plus, no bare fraction.
var thresholdPattern = regexp.MustCompile(`^(?:0|1(?:\.0+)?|0\.[0-9]+)$`)

// ThresholdFrom reads ARIA_QC_PASS_THRESHOLD through getenv.
// A nil getenv, or a value that is not a plain decimal in [0, 1], is an error.
// An empty or whitespace-only value returns DefaultThreshold.
func ThresholdFrom(getenv func(string) string) (float64, error) {
	if getenv == nil {
		return 0, fmt.Errorf("%w: no environment", ErrThreshold)
	}
	raw := strings.TrimSpace(getenv(EnvQCPassThreshold))
	if raw == "" {
		return DefaultThreshold, nil
	}
	if !thresholdPattern.MatchString(raw) {
		return 0, fmt.Errorf("%w: %q", ErrThreshold, raw)
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1 {
		return 0, fmt.Errorf("%w: %q", ErrThreshold, raw)
	}
	return v, nil
}

// LoadThreshold reads ARIA_QC_PASS_THRESHOLD from the process environment.
func LoadThreshold() (float64, error) {
	return ThresholdFrom(os.Getenv)
}
