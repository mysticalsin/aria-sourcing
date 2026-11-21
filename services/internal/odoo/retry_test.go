package odoo_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/internal/odoo"
)

type retryOnce struct {
	base *memRPC
	n    int
}

func (r *retryOnce) RoundTrip(req *http.Request) (*http.Response, error) {
	r.n++
	if r.n == 1 {
		io.Copy(io.Discard, req.Body)
		return jsonResponse(429, map[string]string{"message": "slow down"}), nil
	}
	return r.base.RoundTrip(req)
}

func TestJSON2KeepsScrubbedFaultBodyAndRetries429(t *testing.T) {
	rpc := newMemRPC()
	rt := &retryOnce{base: rpc}
	c := testClient(t, "19", "", rt)
	if _, err := c.UpsertJob(context.Background(), odoo.Job{AriaID: "job-9", IdempotencyKey: "job-9", Name: "Synthetic role"}); err != nil {
		t.Fatal(err)
	}
	if rt.n < 2 {
		t.Fatalf("hits = %d, want a retry", rt.n)
	}

	bad := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		io.Copy(io.Discard, r.Body)
		key := r.Header.Get("Authorization")
		key = strings.TrimPrefix(key, "bearer ")
		return jsonResponse(422, map[string]string{"message": "stage missing " + key}), nil
	})
	c = testClient(t, "19", "", bad)
	_, err := c.UpsertJob(context.Background(), odoo.Job{AriaID: "job-8", IdempotencyKey: "job-8", Name: "Synthetic role"})
	if err == nil || !strings.Contains(err.Error(), "stage missing") || strings.Contains(err.Error(), "canary-not-a-credential") || !strings.Contains(err.Error(), "[redacted]") {
		t.Fatalf("err = %v", err)
	}
}

func TestJSON2DoesNotHoldLockAcrossCall(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	var n int
	var mu sync.Mutex
	rt := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		n++
		mine := n
		mu.Unlock()
		if mine == 1 {
			once.Do(func() { close(started) })
			<-release
		}
		io.Copy(io.Discard, r.Body)
		if strings.Contains(r.URL.Path, "/create") {
			return jsonResponse(200, []int64{1}), nil
		}
		return jsonResponse(200, []map[string]any{}), nil
	})
	c := testClient(t, "19", "", rt)
	go func() {
		_, _ = c.UpsertJob(context.Background(), odoo.Job{AriaID: "job-7", IdempotencyKey: "job-7", Name: "Synthetic role"})
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("no request")
	}
	done := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		_, _ = c.ReadJob(ctx, "job-missing")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(200 * time.Millisecond):
		close(release)
		t.Fatal("ReadJob blocked while the HTTP call was in flight")
	}
	close(release)
}
