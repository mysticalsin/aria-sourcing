package channels

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestHeyReachNeverCallsCookieOrProxyEndpoints is the HeyReach safeguard:
// Aria does not call ConnectWithCookies or UpdateProxy, including their URL
// path forms. Those names may appear only in this file and the deny-list
// constant.
func TestHeyReachNeverCallsCookieOrProxyEndpoints(t *testing.T) {
	needles := heyReachForbiddenEndpointNames()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	root := filepath.Dir(file)
	allowed := map[string]bool{
		filepath.Base(file): true,
		"heyreach_deny.go":  true,
	}
	denyFile := filepath.Join(root, "heyreach_deny.go")
	denyText, err := os.ReadFile(denyFile)
	if err != nil {
		t.Fatalf("deny-list constant file is missing: %v", err)
	}
	denyFold := strings.ToLower(string(denyText))
	for _, needle := range needles {
		if !strings.Contains(denyFold, strings.ToLower(needle)) {
			t.Errorf("deny-list constant does not name %q", needle)
		}
	}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		blob, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := strings.ToLower(string(blob))
		base := filepath.Base(path)
		for _, needle := range needles {
			if !strings.Contains(text, strings.ToLower(needle)) {
				continue
			}
			if !allowed[base] {
				t.Errorf("%s contains %q", base, needle)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	rig := newHeyRig(nil, http.StatusOK, `{"ok":true}`)
	defer rig.http.srv.Close()
	if _, err := rig.ch.Send(context.Background(), rig.approved(t, CampaignMode{})); err != nil {
		t.Fatal(err)
	}
	for _, call := range rig.http.snapshot() {
		for _, needle := range needles {
			if strings.Contains(strings.ToLower(call.Path), strings.ToLower(needle)) {
				t.Fatalf("adapter called denied path %s", call.Path)
			}
		}
	}

	blocked := newHeyServer(http.StatusOK, `{"ok":true}`)
	defer blocked.srv.Close()
	badBase := blocked.srv.URL + "/" + strings.TrimPrefix(needles[2], "/")
	ch, err := newHeyReachForTest(HeyReachConfig{
		Env:      heyEnv(badBase, nil),
		TokenKey: tokenKey(),
		Auditor:  &memAudit{},
		Clock:    rig.clock,
		HTTP:     blocked.srv.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	msg := rig.approved(t, CampaignMode{})
	if _, err := ch.Send(context.Background(), msg); err == nil {
		t.Fatal("denied endpoint was accepted")
	}
	if blocked.count() != 0 {
		t.Fatalf("denied endpoint was dialed %d times", blocked.count())
	}
}

func heyReachForbiddenEndpointNames() []string {
	methodA := "ConnectWithCookies"
	methodB := "UpdateProxy"
	return []string{
		methodA,
		methodB,
		"/api/public/li_account/" + methodA,
		"/api/public/li_account/" + methodB,
	}
}
