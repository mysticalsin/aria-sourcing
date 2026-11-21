package channels

import (
	"context"
	"testing"
	"time"
)

func TestHumanResumeClearsAnOpenPause(t *testing.T) {
	store := NewMemoryPauseStore()
	ctx := context.Background()
	if err := store.Pause(ctx, "sender:ada", time.Time{}, "account-warning"); err != nil {
		t.Fatal(err)
	}
	if err := store.Resume(ctx, "sender:ada"); err != nil {
		t.Fatal(err)
	}
	paused, err := store.Paused(ctx, "sender:ada", time.Now())
	if err != nil || paused {
		t.Fatalf("paused=%v err=%v", paused, err)
	}
}
