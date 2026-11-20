package aria

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestABIVersionAndStageKeys(t *testing.T) {
	if got := int(C_aria_version()); got != 1 {
		t.Fatalf("abi version %d", got)
	}
	keys, err := StageKeys()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"to_rate", "to_assess", "to_interview", "shoot", "qm", "to_hire", "hired", "rejected", "withdrawn"}
	if len(keys) != len(want) {
		t.Fatalf("keys %#v", keys)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("key %d = %q, want %q", i, keys[i], want[i])
		}
	}
}

func TestScoreBatchMatchesTypescriptFixture(t *testing.T) {
	fixture := loadScoringFixture(t)
	// The first case is the Europe/Berlin vector. Its breakdown must match
	// the TypeScript golden file, including rationales.
	berlin := fixture.Cases[0]
	scored, err := ScoreOne(candidateFrom(berlin.Candidate), jobFrom(berlin.Job), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !scored.SuggestionOnly {
		t.Fatal("suggestionOnly must stay true")
	}
	if scored.Score != berlin.Expect.Score {
		t.Fatalf("score %v != %v", scored.Score, berlin.Expect.Score)
	}
	if len(scored.Breakdown) != len(berlin.Expect.Breakdown) {
		t.Fatalf("breakdown len %d", len(scored.Breakdown))
	}
	for i, row := range scored.Breakdown {
		want := berlin.Expect.Breakdown[i]
		if row.Key != want.Key || row.Label != want.Label || row.Score != want.Score || row.Weight != want.Weight || row.Contribution != want.Contribution || row.Rationale != want.Rationale {
			t.Fatalf("row %d\n got %#v\nwant %#v", i, row, want)
		}
	}

	candidates := make([]Candidate, len(fixture.Batch.Candidates))
	for i, row := range fixture.Batch.Candidates {
		candidates[i] = candidateFrom(row.Candidate)
	}
	scores, err := ScoreBatch(candidates, jobFrom(fixture.Batch.Job), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(scores) != 500 {
		t.Fatalf("batch kept %d of 500", len(scores))
	}
	for i, score := range scores {
		if score != fixture.Batch.Expect[i].Score {
			t.Fatalf("batch %s score %v != %v", fixture.Batch.Candidates[i].ID, score, fixture.Batch.Expect[i].Score)
		}
		if !fixture.Batch.Expect[i].SuggestionOnly {
			t.Fatal("fixture suggestionOnly drifted")
		}
	}
}

func TestRankKeepsEveryCandidate(t *testing.T) {
	order, err := Rank([]float64{1, 5, 0, 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(order) != 4 {
		t.Fatalf("rank length %d", len(order))
	}
	// 5, 5, 1, 0. Equal scores keep the lower index first because the id is the index.
	if order[0] != 1 || order[1] != 3 || order[2] != 0 || order[3] != 2 {
		t.Fatalf("order %v", order)
	}
}

func TestApprovalHashAnyByteChange(t *testing.T) {
	body := []byte("Exact outreach body for ada@example.test.\nSecond line stays put.")
	base, err := ApprovalHash([]byte("email"), []byte("ada@example.test"), []byte("Hello Ada"), body, []byte("art14-lgpd-2026-11"))
	if err != nil {
		t.Fatal(err)
	}
	if len(base) != 64 {
		t.Fatalf("hex %q", base)
	}
	for i := range body {
		mutated := append([]byte(nil), body...)
		mutated[i] ^= 0xff
		got, err := ApprovalHash([]byte("email"), []byte("ada@example.test"), []byte("Hello Ada"), mutated, []byte("art14-lgpd-2026-11"))
		if err != nil {
			t.Fatal(err)
		}
		if got == base {
			t.Fatalf("byte %d did not change the hash", i)
		}
	}
	// An interior NUL is part of the exact text, not a C-string terminator.
	withNUL, err := ApprovalHash([]byte("email"), []byte("ada@example.test"), []byte("Hello"), []byte("a\x00b"), []byte("n"))
	if err != nil {
		t.Fatal(err)
	}
	without, err := ApprovalHash([]byte("email"), []byte("ada@example.test"), []byte("Hello"), []byte("ab"), []byte("n"))
	if err != nil {
		t.Fatal(err)
	}
	if withNUL == without {
		t.Fatal("interior NUL was ignored")
	}
}

func TestHiredRequiresContractAndDna(t *testing.T) {
	next, stayed, err := Transition("to_hire", "advance", "", "contract-example-1", true)
	if err != nil || stayed || next != "hired" {
		t.Fatalf("hired next=%s stayed=%v err=%v", next, stayed, err)
	}
	_, _, err = Transition("hired", "advance", "", "contract-example-1", true)
	if err == nil {
		t.Fatal("hired must be terminal")
	}
	for _, tc := range []struct {
		contract string
		dna      bool
	}{
		{"", false},
		{"contract-example-1", false},
		{"", true},
		{"   ", true},
	} {
		next, stayed, err := Transition("to_hire", "advance", "", tc.contract, tc.dna)
		if err != nil || !stayed || next != "to_hire" {
			t.Fatalf("contract=%q dna=%v next=%s stayed=%v err=%v", tc.contract, tc.dna, next, stayed, err)
		}
	}
}

func TestToHireIsDefaultWithoutContract(t *testing.T) {
	next, stayed, err := Transition("qm", "advance", "", "", false)
	if err != nil || stayed || next != "to_hire" {
		t.Fatalf("qm -> %s stayed=%v err=%v", next, stayed, err)
	}
	next, stayed, err = Transition("to_hire", "advance", "", "", false)
	if err != nil || !stayed || next != "to_hire" {
		t.Fatalf("default next=%s stayed=%v err=%v", next, stayed, err)
	}
}

func TestRejectRequiresReasonAndIsNotImpliedByScore(t *testing.T) {
	if _, _, err := Transition("to_assess", "reject", "", "", false); err == nil {
		t.Fatal("reject without a reason must fail")
	}
	next, _, err := Transition("to_assess", "reject", "Synthetic withdrawal of the role", "", false)
	if err != nil || next != "rejected" {
		t.Fatalf("explicit reject next=%s err=%v", next, err)
	}
	// A low score is not an action. The binding has no score-to-reject call.
	scores, err := ScoreBatch([]Candidate{{
		TechStack:      []string{"cobol"},
		Years:          floatPtr(1),
		Location:       "Austin, Texas",
		Timezone:       "CST",
		RecentActivity: "",
	}}, Job{
		LocationType:   "Remote",
		Location:       "Europe",
		Regions:        []string{"EU"},
		Timezone:       "CET",
		RequiredSkills: []string{"TypeScript"},
		MinYears:       floatPtr(5),
		MaxYears:       floatPtr(8),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(scores) != 1 {
		t.Fatalf("low score dropped: %#v", scores)
	}
}

func TestResolveEntitiesThroughCABI(t *testing.T) {
	roots, err := ResolveEntities([]Identity{
		{Name: "a", Email: "a@example.test", GitHubURL: "https://github.com/a-person"},
		{Name: "b", Email: "A@example.test"},
		{Name: "c", Email: "c@example.test", GitHubURL: "https://www.github.com/a-person/"},
		{Name: "g"},
		{Name: "h"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if roots[0] != roots[1] || roots[1] != roots[2] {
		t.Fatalf("strong keys did not join: %v", roots)
	}
	if roots[3] == roots[4] || roots[3] == roots[0] {
		t.Fatalf("blank records collapsed: %v", roots)
	}
}

func BenchmarkScoreBatch500(b *testing.B) {
	fixture := loadScoringFixture(b)
	candidates := make([]Candidate, len(fixture.Batch.Candidates))
	for i, row := range fixture.Batch.Candidates {
		candidates[i] = candidateFrom(row.Candidate)
	}
	job := jobFrom(fixture.Batch.Job)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		scores, err := ScoreBatch(candidates, job, nil)
		if err != nil {
			b.Fatal(err)
		}
		if len(scores) != 500 {
			b.Fatalf("len %d", len(scores))
		}
	}
}

func TestMeasureFFIBatchP95(t *testing.T) {
	if os.Getenv("ARIA_MEASURE_P95") == "" {
		t.Skip()
	}
	fixture := loadScoringFixture(t)
	candidates := make([]Candidate, len(fixture.Batch.Candidates))
	for i, row := range fixture.Batch.Candidates {
		candidates[i] = candidateFrom(row.Candidate)
	}
	job := jobFrom(fixture.Batch.Job)
	if _, err := ScoreBatch(candidates, job, nil); err != nil {
		t.Fatal(err)
	}
	const iterations = 200
	samples := make([]int64, iterations)
	for i := 0; i < 20; i++ {
		if _, err := ScoreBatch(candidates, job, nil); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < iterations; i++ {
		start := time.Now()
		if _, err := ScoreBatch(candidates, job, nil); err != nil {
			t.Fatal(err)
		}
		samples[i] = time.Since(start).Nanoseconds()
	}
	sortInt64(samples)
	index := int(float64(len(samples))*0.95+0.999999) - 1
	if index < 0 {
		index = 0
	}
	t.Logf(`{"name":"ffi_score_batch_500_p95","unit":"ns","value":%d}`, samples[index])
}

func C_aria_version() int {
	return int(cABIVersion())
}

func floatPtr(v float64) *float64 { return &v }

type scoringFixture struct {
	Cases []scoringCase `json:"cases"`
	Batch batchFixture  `json:"batch500"`
}

type scoringCase struct {
	Name      string       `json:"name"`
	Candidate fixCandidate `json:"candidate"`
	Job       fixJob       `json:"job"`
	Expect    expectScore  `json:"expect"`
}

type batchFixture struct {
	Job        fixJob        `json:"job"`
	Candidates []batchCand   `json:"candidates"`
	Expect     []expectScore `json:"expect"`
}

type batchCand struct {
	ID        string       `json:"id"`
	Candidate fixCandidate `json:"-"`
	Raw       fixCandidate `json:",inline"`
}

func (b *batchCand) UnmarshalJSON(data []byte) error {
	var raw fixCandidate
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var id struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &id); err != nil {
		return err
	}
	b.ID = id.ID
	b.Candidate = raw
	return nil
}

type fixCandidate struct {
	TechStack              []string `json:"techStack"`
	YearsExperience        *float64 `json:"yearsExperience"`
	CompanyStageExperience []string `json:"companyStageExperience"`
	IndustryExperience     []string `json:"industryExperience"`
	Location               string   `json:"location"`
	Timezone               string   `json:"timezone"`
	RecentActivity         string   `json:"recentActivity"`
}

type fixJob struct {
	LocationType       string   `json:"locationType"`
	Location           string   `json:"location"`
	Regions            []string `json:"regions"`
	Timezone           string   `json:"timezone"`
	RequiredSkills     []string `json:"requiredSkills"`
	NiceToHaveSkills   []string `json:"niceToHaveSkills"`
	MinYearsExperience *float64 `json:"minYearsExperience"`
	MaxYearsExperience *float64 `json:"maxYearsExperience"`
	CompanyStageTarget []string `json:"companyStageTarget"`
	IndustryExperience []string `json:"industryExperience"`
}

type expectScore struct {
	Score          float64        `json:"score"`
	SuggestionOnly bool           `json:"suggestionOnly"`
	Breakdown      []BreakdownRow `json:"breakdown"`
}

func loadScoringFixture(t testing.TB) scoringFixture {
	t.Helper()
	path := filepath.Join("..", "..", "fixtures", "scoring-vectors.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture scoringFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func candidateFrom(c fixCandidate) Candidate {
	return Candidate{
		TechStack:      c.TechStack,
		Years:          c.YearsExperience,
		CompanyStages:  c.CompanyStageExperience,
		Industries:     c.IndustryExperience,
		Location:       c.Location,
		Timezone:       c.Timezone,
		RecentActivity: c.RecentActivity,
	}
}

func jobFrom(job fixJob) Job {
	return Job{
		LocationType:     job.LocationType,
		Location:         job.Location,
		Regions:          job.Regions,
		Timezone:         job.Timezone,
		RequiredSkills:   job.RequiredSkills,
		NiceToHaveSkills: job.NiceToHaveSkills,
		MinYears:         job.MinYearsExperience,
		MaxYears:         job.MaxYearsExperience,
		CompanyStages:    job.CompanyStageTarget,
		Industries:       job.IndustryExperience,
	}
}

func sortInt64(values []int64) {
	for i := 1; i < len(values); i++ {
		j := i
		for j > 0 && values[j] < values[j-1] {
			values[j], values[j-1] = values[j-1], values[j]
			j--
		}
	}
}
