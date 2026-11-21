package dedupe

import (
	"context"
	"testing"
)

func TestEmailWinsOverName(t *testing.T) {
	h := NewMemory()
	ctx := context.Background()
	first, err := h.Observe(ctx, Fingerprint{UploadID: "a", Email: "Casey.Sample@example.test", Name: "Casey Example", Phone: "+33 1 99 00 11 22"})
	if err != nil || first != nil {
		t.Fatalf("first %+v %v", first, err)
	}
	// Same email, different name: duplicate of a.
	second, err := h.Observe(ctx, Fingerprint{UploadID: "b", Email: "casey.sample@example.test", Name: "Other Person"})
	if err != nil || second == nil || second.UploadID != "a" {
		t.Fatalf("second %+v %v", second, err)
	}
	// Different email, same phone and name: not a duplicate, because both
	// rows have an email and the emails differ.
	third, err := h.Observe(ctx, Fingerprint{UploadID: "c", Email: "other.person@example.test", Name: "Casey Example", Phone: "+33199001122"})
	if err != nil || third != nil {
		t.Fatalf("third %+v %v", third, err)
	}
	// Retry of a is not a duplicate of itself.
	again, err := h.Observe(ctx, Fingerprint{UploadID: "a", Email: "casey.sample@example.test"})
	if err != nil || again != nil {
		t.Fatalf("self %+v %v", again, err)
	}
	if h.Calls() != 4 {
		t.Fatalf("calls %d", h.Calls())
	}
}

func TestPhoneThenName(t *testing.T) {
	ctx := context.Background()
	h := NewMemory()
	if _, err := h.Observe(ctx, Fingerprint{UploadID: "p1", Phone: "+1 555 010 0199"}); err != nil {
		t.Fatal(err)
	}
	got, err := h.Observe(ctx, Fingerprint{UploadID: "p2", Phone: "+15550100199"})
	if err != nil || got == nil || got.UploadID != "p1" {
		t.Fatalf("phone match %+v %v", got, err)
	}

	names := NewMemory()
	if _, err := names.Observe(ctx, Fingerprint{UploadID: "n1", Name: "Quinn  Placeholder"}); err != nil {
		t.Fatal(err)
	}
	got, err = names.Observe(ctx, Fingerprint{UploadID: "n2", Name: "quinn placeholder"})
	if err != nil || got == nil || got.UploadID != "n1" {
		t.Fatalf("name match %+v %v", got, err)
	}
}

func TestEmptyKeyDoesNotCollapse(t *testing.T) {
	h := NewMemory()
	ctx := context.Background()
	a, err := h.Observe(ctx, Fingerprint{UploadID: "e1"})
	if err != nil || a != nil {
		t.Fatal(a, err)
	}
	b, err := h.Observe(ctx, Fingerprint{UploadID: "e2"})
	if err != nil || b != nil {
		t.Fatal(b, err)
	}
}
