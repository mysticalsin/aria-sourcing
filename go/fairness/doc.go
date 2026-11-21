// Package fairness audits one ranking run offline for recruiter prioritisation.
//
// The protected-group label is optional, self-declared, and consented. It is
// never passed to a Scorer and it is never a reason to drop a candidate. The
// report has no auto-reject. A human decides. A Pass is not a certification
// under the EU AI Act, the GDPR, or anti-discrimination law.
//
// Selection-rate parity uses the EEOC four-fifths rule: adverse impact is a
// selection rate strictly less than 4/5 of the highest group's rate, compared
// in integers so the boundary at exactly 4/5 is stable:
//
//	selected(g) * n(reference) * 5 < selected(reference) * n(g) * 4
//
// A group smaller than the minimum size gets no Pass, Warn, or Fail on a
// disparity metric. The ratio may still be shown as descriptive.
//
// Rank exposure of a candidate is 1/log2(rank+1). The group figure is the mean.
// Counterfactual checks rescore text after swapping a synthetic name token or
// a gender marker. The score must stay within epsilon. Proxy features
// (postcode, graduation year, photo) are flagged for a human. Every ranked
// candidate must have at least one top reason.
package fairness
