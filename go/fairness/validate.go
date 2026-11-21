package fairness

import (
	"errors"
	"fmt"
	"strings"
)

func validate(run Run) error {
	if len(run.Candidates) == 0 {
		return errors.New("fairness: no candidates")
	}
	if run.SelectionCutoff < 1 {
		return errors.New("fairness: selection cutoff must be positive")
	}
	seenID := make(map[string]struct{}, len(run.Candidates))
	seenRank := make(map[int]struct{}, len(run.Candidates))
	for _, c := range run.Candidates {
		id := strings.TrimSpace(c.ID)
		if id == "" {
			return errors.New("fairness: empty id")
		}
		if _, ok := seenID[c.ID]; ok {
			return fmt.Errorf("fairness: duplicate id %s", c.ID)
		}
		seenID[c.ID] = struct{}{}
		if c.Rank < 1 {
			return errors.New("fairness: rank must be positive")
		}
		if _, ok := seenRank[c.Rank]; ok {
			return fmt.Errorf("fairness: duplicate rank %d", c.Rank)
		}
		seenRank[c.Rank] = struct{}{}
	}
	return nil
}

func resolveMinGroupSize(run Run, opt Options) int {
	if opt.MinGroupSize > 0 {
		return opt.MinGroupSize
	}
	if run.MinGroupSize > 0 {
		return run.MinGroupSize
	}
	return DefaultMinGroupSize
}

func resolveEpsilon(run Run, opt Options) float64 {
	if opt.Epsilon > 0 {
		return opt.Epsilon
	}
	if run.Epsilon > 0 {
		return run.Epsilon
	}
	return DefaultEpsilon
}
