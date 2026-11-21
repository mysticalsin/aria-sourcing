// Package testenv installs the guards shared by the service tests.
package testenv

import (
	"errors"
	"net/http"
)

// DisableNetwork replaces the default HTTP client so a test that accidentally
// dials fails closed. Adapter tests pass an explicit in-memory transport.
func DisableNetwork() {
	rt := roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("network is disabled in tests")
	})
	http.DefaultTransport = rt
	http.DefaultClient = &http.Client{Transport: rt}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
