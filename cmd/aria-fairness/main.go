// Command aria-fairness audits a ranking run offline.
// The red commit does not implement the commands yet.
package main

import (
	"fmt"
	"io"
	"os"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	fmt.Fprintln(stderr, "fairness: not implemented")
	return 1
}
