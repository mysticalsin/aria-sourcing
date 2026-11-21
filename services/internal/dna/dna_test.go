package dna

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/mysticalsin/aria-sourcing/services/internal/testenv"
)

func init() { testenv.DisableNetwork() }

func TestFakeReportsIntegrationByCandidateAndNeed(t *testing.T) {
	f := NewFake()
	ctx := context.Background()
	status, err := f.ContractIntegration(ctx, "cand-2002", "need-1001")
	if err != nil || status.Integrated {
		t.Fatalf("unknown pair = %+v %v", status, err)
	}
	f.Seed("cand-2002", "need-1001", true)
	status, err = f.ContractIntegration(ctx, "cand-2002", "need-1001")
	if err != nil || !status.Integrated || status.CandidateID != "cand-2002" || status.NeedID != "need-1001" {
		t.Fatalf("seeded pair = %+v %v", status, err)
	}
	other, err := f.ContractIntegration(ctx, "cand-2002", "need-other")
	if err != nil || other.Integrated {
		t.Fatalf("other need = %+v %v", other, err)
	}
}

func TestFakeHasNoCredentialOrNetworkFields(t *testing.T) {
	typ := reflect.TypeOf(Fake{})
	for i := 0; i < typ.NumField(); i++ {
		name := strings.ToLower(typ.Field(i).Name)
		for _, banned := range []string{"url", "token", "secret", "password", "key", "host", "endpoint", "cookie"} {
			if strings.Contains(name, banned) {
				t.Fatalf("field %s looks like a credential or endpoint", typ.Field(i).Name)
			}
		}
	}
	f := NewFake()
	f.SetError(errors.New("dna unavailable"))
	_, err := f.ContractIntegration(context.Background(), "cand-2002", "need-1001")
	if err == nil || !strings.Contains(err.Error(), "dna unavailable") {
		t.Fatal(err)
	}
}
