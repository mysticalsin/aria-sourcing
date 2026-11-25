package recruit_test

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
	"github.com/mysticalsin/aria-sourcing/services/internal/stage"
)

func TestStressA5HiredGate(t *testing.T) {
	start := time.Now()
	defer func() {
		if time.Since(start) > 2*time.Minute {
			t.Fatalf("wall clock %s", time.Since(start))
		}
	}()
	ctx := context.Background()
	s := newStack(t)
	s.campaign(t)
	const digest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	var hiredWithout atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		id := fmt.Sprintf("race-%d", i)
		app := s.candidate(t, id, true)
		wg.Add(1)
		go func(ariaID string) {
			defer wg.Done()
			_, err := s.svc.Transition(ctx, ariaID, stage.Hired)
			if err == nil {
				hiredWithout.Add(1)
			}
		}(app.AriaID)
	}
	wg.Wait()
	if hiredWithout.Load() != 0 {
		t.Fatalf("200-writer race hired %d applicants with no contract", hiredWithout.Load())
	}

	var sendsAfter atomic.Int64
	for round := 0; round < 20; round++ {
		id := fmt.Sprintf("round-%d", round)
		app := s.candidate(t, id, true)
		reach(t, s.svc, app.AriaID, stage.ToHire)
		var committed atomic.Bool
		var inner sync.WaitGroup
		for n := 0; n < 50; n++ {
			inner.Add(1)
			go func(n int) {
				defer inner.Done()
				for !committed.Load() {
					_, _ = s.svc.Transition(ctx, app.AriaID, stage.Hired)
				}
				_, err := s.svc.LogTouch(ctx, odoo.Touch{
					IdempotencyKey:  fmt.Sprintf("touch-%s-%d", app.AriaID, n),
					ApplicantAriaID: app.AriaID,
					Channel:         "email",
					Kind:            "message",
					Subject:         "Synthetic",
					Body:            "Synthetic outreach after the gate.",
				})
				if err == nil {
					sendsAfter.Add(1)
				}
			}(n)
		}
		if _, err := s.svc.AttachContract(ctx, app.AriaID, odoo.Contract{Filename: "contract-synthetic.pdf", SHA256: digest}); err != nil {
			t.Fatal(err)
		}
		s.dna.Seed("cand-"+app.AriaID, "need-1001", true)
		if _, err := s.svc.Transition(ctx, app.AriaID, stage.Hired); err != nil {
			live, readErr := s.fake.ReadApplicant(ctx, app.AriaID)
			if readErr != nil || live.Stage != stage.Hired || !live.HasContract() {
				t.Fatalf("round %d hire with contract and DNA: %v stage=%s", round, err, live.Stage)
			}
		}
		committed.Store(true)
		inner.Wait()
		live, err := s.fake.ReadApplicant(ctx, app.AriaID)
		if err != nil || live.Stage != stage.Hired {
			t.Fatalf("round %d state %+v %v", round, live, err)
		}
	}
	if sendsAfter.Load() != 0 {
		t.Fatalf("sends committed after the hire gate: %d", sendsAfter.Load())
	}
	for i := 0; i < 200; i++ {
		live, err := s.fake.ReadApplicant(ctx, fmt.Sprintf("race-%d", i))
		if err != nil {
			t.Fatal(err)
		}
		if live.Stage == stage.Hired {
			t.Fatalf("%s reached hired", live.AriaID)
		}
	}
}
