package qc

import (
	"fmt"
	"math"
)

var checkOrder = []string{
	CheckGrounding,
	CheckProtected,
	CheckOptOut,
	CheckLength,
	CheckPlaceholder,
	CheckPromises,
	CheckLanguage,
}

// Evaluate scores one draft. It reads only in and threshold. A threshold
// outside [0, 1], or a NaN or infinity, returns ErrThreshold and a zero Result.
// Any failed check forces FAIL, including when the numeric score still meets
// the threshold.
func Evaluate(in Input, threshold float64) (Result, error) {
	if err := validateThreshold(threshold); err != nil {
		return Result{}, err
	}
	checks := []checkResult{
		checkGrounding(in),
		checkProtected(in),
		checkOptOut(in.Draft),
		checkLength(in.Draft),
		checkPlaceholder(in.Draft),
		checkPromises(in.Draft),
		checkLanguage(in),
	}
	if len(checks) != len(checkOrder) {
		return Result{}, fmt.Errorf("qc: check list drifted")
	}
	earned := 0
	weight := 0
	allPass := true
	reasons := make([]Reason, 0, len(checks))
	for i, check := range checks {
		if check.id != checkOrder[i] {
			return Result{}, fmt.Errorf("qc: check order drifted at %s", check.id)
		}
		if check.weight <= 0 || check.earned < 0 || check.earned > check.weight {
			return Result{}, fmt.Errorf("qc: bad weight for %s", check.id)
		}
		earned += check.earned
		weight += check.weight
		if !check.pass {
			allPass = false
		}
		detail := check.detail
		if detail == "" {
			detail = "ok"
		}
		reasons = append(reasons, Reason{Check: check.id, Pass: check.pass, Detail: detail})
	}
	if weight != weightTotal() {
		return Result{}, fmt.Errorf("qc: weights sum to %d", weight)
	}
	score := float64(earned) / float64(weight)
	status := StatusFail
	if allPass && basisAtLeast(earned, weight, threshold) {
		status = StatusPass
	}
	return Result{
		status:    status,
		score:     score,
		version:   QCVersion,
		reasons:   reasons,
		draftHash: DraftHash(in.Draft),
	}, nil
}

func weightTotal() int {
	return weightGrounding + weightProtected + weightOptOut + weightLength + weightPlaceholder + weightPromises + weightLanguage
}

func validateThreshold(threshold float64) error {
	if math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 || threshold > 1 {
		return fmt.Errorf("%w: out of range", ErrThreshold)
	}
	return nil
}

func basisAtLeast(earned, weight int, threshold float64) bool {
	if weight <= 0 {
		return false
	}
	// earned/weight >= threshold, compared in integers so 0.9 is not a float edge.
	need := int(math.Round(threshold*float64(weight) + 1e-9))
	return earned >= need
}
