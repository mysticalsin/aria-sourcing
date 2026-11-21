package fairness

import "errors"

// errNotImplemented keeps the red commit compiling while the audit is absent.
var errNotImplemented = errors.New("fairness: not implemented")

// Audit will evaluate one ranking run. The red commit returns an error.
func Audit(run Run, opt Options) (Report, error) {
	return Report{}, errNotImplemented
}

// Generate will build a synthetic run from a seed. The red commit returns an error.
func Generate(seed int64, spec GenSpec) (Run, error) {
	return Run{}, errNotImplemented
}

// Markdown will render the report. The red commit returns an empty string.
func (r Report) Markdown() string { return "" }

// JSON will encode the report. The red commit returns an error.
func (r Report) JSON() ([]byte, error) { return nil, errNotImplemented }
