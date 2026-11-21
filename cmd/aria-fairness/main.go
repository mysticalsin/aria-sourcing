// Command aria-fairness generates a synthetic ranking and audits it offline.
// It does not reject a candidate and it does not call a model.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/mysticalsin/aria-sourcing/go/fairness"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: aria-fairness generate|audit")
		return 1
	}
	switch args[0] {
	case "generate":
		return cmdGenerate(args[1:], stdout, stderr)
	case "audit":
		return cmdAudit(args[1:], stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unknown command %q\n", args[0])
		return 1
	}
}

func cmdGenerate(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("generate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	seed := fs.Int64("seed", 1, "deterministic seed")
	n := fs.Int("n", 40, "number of synthetic candidates")
	cutoff := fs.Int("cutoff", 0, "selection cutoff (rank <= cutoff); 0 uses half the list")
	out := fs.String("out", "", "output JSON path")
	proxyEvery := fs.Int("proxy-every", 4, "add proxy features every N candidates; 0 adds none")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	if *out == "" {
		fmt.Fprintln(stderr, "generate: --out is required")
		return 1
	}
	run, err := fairness.Generate(*seed, fairness.GenSpec{
		N:          *n,
		Cutoff:     *cutoff,
		ProxyEvery: *proxyEvery,
	})
	if err != nil {
		fmt.Fprintf(stderr, "generate: %v\n", err)
		return 1
	}
	raw, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		fmt.Fprintf(stderr, "generate: %v\n", err)
		return 1
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(*out, raw, 0o644); err != nil {
		fmt.Fprintf(stderr, "generate: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "wrote %s\n", *out)
	return 0
}

func cmdAudit(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("audit", flag.ContinueOnError)
	fs.SetOutput(stderr)
	in := fs.String("in", "", "ranking JSON path")
	jsonOut := fs.String("json-out", "", "report JSON path")
	mdOut := fs.String("md-out", "", "report markdown path")
	minN := fs.Int("min-group-size", 0, "minimum group size for a disparity verdict")
	epsilon := fs.Float64("epsilon", 0, "counterfactual absolute tolerance")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	if *in == "" || *jsonOut == "" || *mdOut == "" {
		fmt.Fprintln(stderr, "audit: --in, --json-out, and --md-out are required")
		return 1
	}
	raw, err := os.ReadFile(*in)
	if err != nil {
		fmt.Fprintf(stderr, "audit: %v\n", err)
		return 1
	}
	var run fairness.Run
	if err := json.Unmarshal(raw, &run); err != nil {
		fmt.Fprintf(stderr, "audit: %v\n", err)
		return 1
	}
	report, err := fairness.Audit(run, fairness.Options{MinGroupSize: *minN, Epsilon: *epsilon})
	if err != nil {
		fmt.Fprintf(stderr, "audit: %v\n", err)
		return 1
	}
	body, err := report.JSON()
	if err != nil {
		fmt.Fprintf(stderr, "audit: %v\n", err)
		return 1
	}
	body = append(body, '\n')
	if err := os.WriteFile(*jsonOut, body, 0o644); err != nil {
		fmt.Fprintf(stderr, "audit: %v\n", err)
		return 1
	}
	md := report.Markdown()
	if err := os.WriteFile(*mdOut, []byte(md), 0o644); err != nil {
		fmt.Fprintf(stderr, "audit: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "verdict %s\n", report.Verdict)
	return 0
}
