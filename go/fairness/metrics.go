package fairness

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

type member struct {
	id       string
	rank     int
	selected bool
}

type cohort struct {
	attribute string
	group     string
	members   []member
}

// cohortKey is the attribute and the value themselves. Joining them with a
// delimiter would merge two consented groups when that byte appears in a label.
type cohortKey struct {
	attribute string
	group     string
}

func (c cohort) counts() (n, selected, rankSum int, exposure float64) {
	sort.Slice(c.members, func(i, j int) bool { return c.members[i].id < c.members[j].id })
	n = len(c.members)
	var exposureSum float64
	for _, m := range c.members {
		rankSum += m.rank
		if m.selected {
			selected++
		}
		exposureSum += exposureAt(m.rank)
	}
	if n > 0 {
		exposure = exposureSum / float64(n)
	}
	return n, selected, rankSum, exposure
}

func exposureAt(rank int) float64 {
	return 1 / math.Log2(float64(rank)+1)
}

func collectCohorts(run Run) (cohorts []cohort, discarded int, warnings []string) {
	index := map[cohortKey]int{}
	for _, c := range run.Candidates {
		if c.ProtectedGroup != nil && !labelUsable(c.ProtectedGroup) {
			discarded++
			warnings = append(warnings, fmt.Sprintf("discarded non-consented or not self-declared label for candidate %s", c.ID))
			continue
		}
		if !labelUsable(c.ProtectedGroup) {
			continue
		}
		attr := strings.TrimSpace(c.ProtectedGroup.Attribute)
		value := strings.TrimSpace(c.ProtectedGroup.Value)
		key := cohortKey{attribute: attr, group: value}
		i, ok := index[key]
		if !ok {
			i = len(cohorts)
			index[key] = i
			cohorts = append(cohorts, cohort{attribute: attr, group: value})
		}
		cohorts[i].members = append(cohorts[i].members, member{
			id:       c.ID,
			rank:     c.Rank,
			selected: c.Rank <= run.SelectionCutoff,
		})
	}
	sort.Slice(cohorts, func(i, j int) bool {
		if cohorts[i].attribute != cohorts[j].attribute {
			return cohorts[i].attribute < cohorts[j].attribute
		}
		return cohorts[i].group < cohorts[j].group
	})
	sort.Strings(warnings)
	return cohorts, discarded, warnings
}

func labelUsable(p *ProtectedLabel) bool {
	return p != nil && p.Consented && p.SelfDeclared &&
		strings.TrimSpace(p.Attribute) != "" && strings.TrimSpace(p.Value) != ""
}

// belowRational reports selected/n < (num/den) * (refSelected/refN) with integer arithmetic.
func belowRational(selected, n, refSelected, refN, num, den int) bool {
	if n <= 0 || refN <= 0 || den <= 0 {
		return false
	}
	left := int64(selected) * int64(refN) * int64(den)
	right := int64(refSelected) * int64(n) * int64(num)
	return left < right
}

func rateLess(selected, n, otherSelected, otherN int) bool {
	return int64(selected)*int64(otherN) < int64(otherSelected)*int64(n)
}

type cohortStats struct {
	cohort
	n        int
	selected int
	rankSum  int
	exposure float64
}

func statsFor(cohorts []cohort) []cohortStats {
	out := make([]cohortStats, len(cohorts))
	for i, c := range cohorts {
		n, selected, rankSum, exposure := c.counts()
		out[i] = cohortStats{cohort: c, n: n, selected: selected, rankSum: rankSum, exposure: exposure}
	}
	return out
}

func attributesOf(stats []cohortStats) []string {
	seen := map[string]struct{}{}
	var attrs []string
	for _, s := range stats {
		if _, ok := seen[s.attribute]; ok {
			continue
		}
		seen[s.attribute] = struct{}{}
		attrs = append(attrs, s.attribute)
	}
	sort.Strings(attrs)
	return attrs
}

func referenceSelection(group []cohortStats) int {
	best := 0
	for i := 1; i < len(group); i++ {
		if rateLess(group[best].selected, group[best].n, group[i].selected, group[i].n) {
			best = i
			continue
		}
		if rateLess(group[i].selected, group[i].n, group[best].selected, group[best].n) {
			continue
		}
		if group[i].group < group[best].group {
			best = i
		}
	}
	return best
}

func referenceExposure(group []cohortStats) int {
	best := 0
	for i := 1; i < len(group); i++ {
		if group[i].exposure > group[best].exposure {
			best = i
			continue
		}
		if group[i].exposure < group[best].exposure {
			continue
		}
		if group[i].group < group[best].group {
			best = i
		}
	}
	return best
}

func selectionVerdict(n, refN, selected, refSelected, minN int) (Verdict, bool, string) {
	if refSelected == 0 {
		return VerdictInsufficient, false, "reference selection rate is zero; not a verdict"
	}
	if n < minN {
		return VerdictInsufficient, false, fmt.Sprintf("group size %d is below minimum %d; ratio is descriptive only and is not a verdict", n, minN)
	}
	if refN < minN {
		return VerdictInsufficient, false, fmt.Sprintf("reference group size %d is below minimum %d; not a verdict", refN, minN)
	}
	if belowRational(selected, n, refSelected, refN, 4, 5) {
		return VerdictFail, true, ""
	}
	if belowRational(selected, n, refSelected, refN, 9, 10) {
		return VerdictWarn, false, ""
	}
	return VerdictPass, false, ""
}

func exposureVerdict(n, refN int, exposure, refExposure float64, minN int) (Verdict, string) {
	if n < minN {
		return VerdictInsufficient, fmt.Sprintf("group size %d is below minimum %d; not a verdict", n, minN)
	}
	if refN < minN {
		return VerdictInsufficient, fmt.Sprintf("reference group size %d is below minimum %d; not a verdict", refN, minN)
	}
	if refExposure == 0 || math.IsNaN(refExposure) || math.IsNaN(exposure) {
		return VerdictInsufficient, "reference exposure is zero; not a verdict"
	}
	if exposure*5 < refExposure*4 {
		return VerdictFail, ""
	}
	gap := refExposure - exposure
	if gap < 0 {
		gap = 0
	}
	if gap > ExposureWarnGap {
		return VerdictWarn, ""
	}
	return VerdictPass, ""
}

func buildMetrics(stats []cohortStats, minN int) (groups []GroupMetric, fifths []FourFifthsRow, exposure []ExposureRow, parity, exposureCheck Verdict) {
	groups = []GroupMetric{}
	fifths = []FourFifthsRow{}
	exposure = []ExposureRow{}
	var parityVerdicts []Verdict
	var exposureVerdicts []Verdict

	byAttr := map[string][]cohortStats{}
	for _, s := range stats {
		byAttr[s.attribute] = append(byAttr[s.attribute], s)
	}
	for _, attr := range attributesOf(stats) {
		group := byAttr[attr]
		sort.Slice(group, func(i, j int) bool { return group[i].group < group[j].group })
		selRef := referenceSelection(group)
		expRef := referenceExposure(group)
		ref := group[selRef]
		eref := group[expRef]
		single := len(group) < 2
		for _, s := range group {
			rate := float64(s.selected) / float64(s.n)
			meanRank := float64(s.rankSum) / float64(s.n)
			verdict, adverse, warning := selectionVerdict(s.n, ref.n, s.selected, ref.selected, minN)
			ratioDefined := ref.selected > 0 && s.n > 0 && ref.n > 0
			ratio := 0.0
			if s.group == ref.group && ratioDefined {
				ratio = 1
			} else if ratioDefined {
				ratio = rate / (float64(ref.selected) / float64(ref.n))
			}
			if single {
				verdict = VerdictInsufficient
				adverse = false
				warning = "only one consented group; not a verdict"
			}
			groups = append(groups, GroupMetric{
				Attribute:     s.attribute,
				Group:         s.group,
				N:             s.n,
				Selected:      s.selected,
				SelectionRate: rate,
				MeanRank:      meanRank,
				Exposure:      s.exposure,
				Verdict:       verdict,
			})
			fifths = append(fifths, FourFifthsRow{
				Attribute:      s.attribute,
				Group:          s.group,
				ReferenceGroup: ref.group,
				N:              s.n,
				Selected:       s.selected,
				SelectionRate:  rate,
				ReferenceN:     ref.n,
				ReferenceRate:  float64(ref.selected) / float64(ref.n),
				Ratio:          ratio,
				RatioDefined:   ratioDefined && !single,
				AdverseImpact:  adverse,
				Verdict:        verdict,
				Warning:        warning,
			})
			parityVerdicts = append(parityVerdicts, verdict)

			eVerdict, eWarning := exposureVerdict(s.n, eref.n, s.exposure, eref.exposure, minN)
			eRatio := 0.0
			if eref.exposure > 0 {
				eRatio = s.exposure / eref.exposure
			}
			gap := eref.exposure - s.exposure
			if gap < 0 {
				gap = 0
			}
			if single {
				eVerdict = VerdictInsufficient
				eWarning = "only one consented group; not a verdict"
			}
			exposure = append(exposure, ExposureRow{
				Attribute:         s.attribute,
				Group:             s.group,
				ReferenceGroup:    eref.group,
				N:                 s.n,
				Exposure:          s.exposure,
				ReferenceExposure: eref.exposure,
				Ratio:             eRatio,
				Gap:               gap,
				Verdict:           eVerdict,
				Warning:           eWarning,
			})
			exposureVerdicts = append(exposureVerdicts, eVerdict)
		}
	}
	if len(parityVerdicts) == 0 {
		parity = VerdictInsufficient
	} else {
		parity = worst(parityVerdicts...)
	}
	if len(exposureVerdicts) == 0 {
		exposureCheck = VerdictInsufficient
	} else {
		exposureCheck = worst(exposureVerdicts...)
	}
	return groups, fifths, exposure, parity, exposureCheck
}

func worst(vs ...Verdict) Verdict {
	out := VerdictPass
	for _, v := range vs {
		if verdictRank(v) > verdictRank(out) {
			out = v
		}
	}
	return out
}

func verdictRank(v Verdict) int {
	switch v {
	case VerdictFail:
		return 3
	case VerdictWarn:
		return 2
	case VerdictInsufficient:
		return 1
	default:
		return 0
	}
}
