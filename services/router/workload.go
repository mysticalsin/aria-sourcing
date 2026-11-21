package router

import "fmt"

// SyntheticWorkload is 1,000 requests shaped to the plan's router mix:
// 80% rules, 15% small model, 5% big model. The sequence is one 20-request
// cycle repeated, so any whole number of cycles keeps the same rates.
// Prompts are synthetic. No real candidate data.
func SyntheticWorkload() []Request {
	const n = 1000
	out := make([]Request, 0, n)
	ri, si, bi := 0, 0, 0
	for i := 0; i < n; i++ {
		var req Request
		switch i % 20 {
		case 0, 1, 2:
			req = smallRequest(si)
			si++
		case 3:
			req = bigRequest(bi)
			bi++
		default:
			req = ruleRequest(ri)
			ri++
		}
		// A unique field keeps the cold pass from caching repeated templates
		// (the same stage label is still a rule hit). The repeat pass sends
		// these same requests, so the cache key matches.
		if req.Fields == nil {
			req.Fields = map[string]string{}
		}
		req.Fields["seq"] = fmt.Sprintf("%04d", i)
		out = append(out, req)
	}
	return out
}

func ruleRequest(i int) Request {
	id := fmt.Sprintf("rule-%04d", i)
	switch i % 8 {
	case 0:
		return Request{ID: id, Task: TaskStageLabel, Input: stageKeys[i%len(stageKeys)]}
	case 1:
		return Request{ID: id, Task: TaskSourceCheck, Input: sourceAllowlist[i%len(sourceAllowlist)]}
	case 2:
		return Request{ID: id, Task: TaskScoreBand, Input: fmt.Sprintf("%d", 70+(i%31))}
	case 3:
		return Request{
			ID:   id,
			Task: TaskNotice,
			Fields: map[string]string{
				"candidate_ref":  fmt.Sprintf("cand-%04d", i),
				"source":         "LinkedIn Recruiter CSV",
				"purpose":        "recruitment",
				"retention_days": "365",
				"notice_version": "2026-11-20",
			},
		}
	case 4:
		return Request{ID: id, Task: TaskOptOut, Input: fmt.Sprintf("cand-%04d@example.test", i)}
	case 5:
		return Request{
			ID:   id,
			Task: TaskSuppression,
			Fields: map[string]string{
				"suppressed":    "true",
				"candidate_ref": fmt.Sprintf("cand-%04d", i),
			},
		}
	case 6:
		return Request{ID: id, Task: TaskQC, Input: qcPassText(i)}
	default:
		return Request{
			ID:   id,
			Task: TaskDraft,
			Fields: map[string]string{
				"candidate_ref":  fmt.Sprintf("cand-%04d", i),
				"role":           "Backend engineer",
				"skill":          "Go",
				"notice_version": "2026-11-20",
			},
			Input: "template",
		}
	}
}

func smallRequest(i int) Request {
	id := fmt.Sprintf("small-%04d", i)
	switch i % 4 {
	case 0:
		return Request{ID: id, Task: TaskClassify, Input: fmt.Sprintf("reply %04d thanks for the note", i), MaxTokens: 400}
	case 1:
		return Request{ID: id, Task: TaskExtract, Input: fmt.Sprintf("cv %04d knows Go and SQL", i), MaxTokens: 400}
	case 2:
		return Request{ID: id, Task: TaskIntake, Input: fmt.Sprintf("need a Go engineer, ref %04d", i), MaxTokens: 400}
	default:
		return Request{
			ID:        id,
			Task:      TaskQC,
			Input:     qcPassText(i),
			Fields:    map[string]string{"qc": "needs_judgment"},
			MaxTokens: 400,
		}
	}
}

func bigRequest(i int) Request {
	return Request{
		ID:          fmt.Sprintf("big-%04d", i),
		Task:        TaskDraft,
		Shortlisted: true,
		Input:       fmt.Sprintf("shortlist draft %04d", i),
		MaxTokens:   1200,
		Fields: map[string]string{
			"candidate_ref":  fmt.Sprintf("cand-%04d", i),
			"role":           "Backend engineer",
			"skill":          "Go",
			"notice_version": "2026-11-20",
		},
	}
}

func qcPassText(i int) string {
	return fmt.Sprintf("[notice] Hello cand-%04d, your application is in review and we will write again. Ref %04d.", i, i)
}
