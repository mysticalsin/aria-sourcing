package fairness

import "fmt"

// Audit evaluates one ranking run. It never removes a candidate and it never
// sets AutoReject. A nil Scorer skips counterfactual rescoring.
func Audit(run Run, opt Options) (Report, error) {
	if err := validate(run); err != nil {
		return Report{}, err
	}
	minN := resolveMinGroupSize(run, opt)
	epsilon := resolveEpsilon(run, opt)

	cohorts, discarded, warnings := collectCohorts(run)
	groups, fifths, exposureRows, parity, exposureCheck := buildMetrics(statsFor(cohorts), minN)
	proxies, proxyVerdict, proxyDetail := flagProxies(run)
	explanations := checkExplanations(run)
	counterfactual, err := runCounterfactual(run, opt.Scorer, epsilon)
	if err != nil {
		return Report{}, err
	}

	checks := []Check{
		{Name: CheckParity, Verdict: parity, Detail: parityDetail(parity, len(fifths))},
		{Name: CheckExposure, Verdict: exposureCheck, Detail: exposureDetail(exposureCheck)},
		{Name: CheckCounterfactual, Verdict: counterfactual.Verdict, Detail: counterfactual.Detail},
		{Name: CheckProxies, Verdict: proxyVerdict, Detail: proxyDetail},
		{Name: CheckExplanations, Verdict: explanations.Verdict, Detail: explanations.Detail},
	}
	overallParts := []Verdict{parity, exposureCheck, proxyVerdict, explanations.Verdict}
	if counterfactual.Ran {
		overallParts = append(overallParts, counterfactual.Verdict)
	}
	if warnings == nil {
		warnings = []string{}
	}

	return Report{
		RunID:                 run.RunID,
		Verdict:               worst(overallParts...),
		Disclaimer:            Disclaimer,
		AutoReject:            false,
		HumanDecisionRequired: true,
		MinGroupSize:          minN,
		Epsilon:               epsilon,
		DiscardedLabels:       discarded,
		Checks:                checks,
		Groups:                groups,
		FourFifths:            fifths,
		Exposure:              exposureRows,
		Counterfactual:        counterfactual,
		Proxies:               proxies,
		Explanations:          explanations,
		Warnings:              warnings,
	}, nil
}

func parityDetail(v Verdict, rows int) string {
	if rows == 0 {
		return "no consented self-declared groups; selection-rate parity is not a verdict. " + FourFifthsFormula
	}
	return fmt.Sprintf("%s Outcome: %s.", FourFifthsFormula, v)
}

func exposureDetail(v Verdict) string {
	return fmt.Sprintf("%s Outcome: %s.", ExposureFormula, v)
}
