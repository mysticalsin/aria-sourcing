package state

import "testing"

func TestHappyPaths(t *testing.T) {
	text := Start()
	for _, next := range []State{TextExtracted, Parsed, Deduped, ReadyForToRate} {
		if err := text.Enter(next); err != nil {
			t.Fatal(err)
		}
	}
	wantText := []State{Uploaded, TextExtracted, Parsed, Deduped, ReadyForToRate}
	assertHistory(t, text, wantText)

	ocr := Start()
	for _, next := range []State{OCRNeeded, OCRDone, Parsed, Deduped, ReadyForToRate} {
		if err := ocr.Enter(next); err != nil {
			t.Fatal(err)
		}
	}
	wantOCR := []State{Uploaded, OCRNeeded, OCRDone, Parsed, Deduped, ReadyForToRate}
	assertHistory(t, ocr, wantOCR)
}

func TestErrorQueueAndRetry(t *testing.T) {
	// Every non-terminal state can fall into the sourcing-error queue.
	starts := [][]State{
		nil,
		{TextExtracted},
		{OCRNeeded},
		{OCRNeeded, OCRDone},
		{TextExtracted, Parsed},
		{TextExtracted, Parsed, Deduped},
	}
	for _, walk := range starts {
		m := Start()
		for _, s := range walk {
			if err := m.Enter(s); err != nil {
				t.Fatal(err)
			}
		}
		if err := m.Enter(ErrorQueue); err != nil {
			t.Fatalf("from %s: %v", m.Current(), err)
		}
		if err := m.Enter(Uploaded); err != nil {
			t.Fatal(err)
		}
	}
}

func TestIllegalTransitions(t *testing.T) {
	m := Start()
	if err := m.Enter(Parsed); err == nil {
		t.Fatal("uploaded must not jump to parsed")
	}
	if got := m.History(); len(got) != 1 || got[0] != Uploaded {
		t.Fatalf("failed enter mutated history: %v", got)
	}
	if err := m.Enter(ReadyForToRate); err == nil {
		t.Fatal("uploaded must not jump to ready")
	}

	done := Start()
	for _, s := range []State{TextExtracted, Parsed, Deduped, ReadyForToRate} {
		if err := done.Enter(s); err != nil {
			t.Fatal(err)
		}
	}
	if err := done.Enter(ErrorQueue); err == nil {
		t.Fatal("ready_for_to_rate is terminal")
	}
	if err := done.Enter(Parsed); err == nil {
		t.Fatal("ready cannot move backwards")
	}
}

func assertHistory(t *testing.T, m *Machine, want []State) {
	t.Helper()
	got := m.History()
	if len(got) != len(want) {
		t.Fatalf("history %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("history %v want %v", got, want)
		}
	}
}
