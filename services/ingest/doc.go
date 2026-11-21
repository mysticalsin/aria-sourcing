// Package ingest turns an uploaded CV into structured fields and a
// ready_for_to_rate hand-off.
//
// The worker is the Toast replacement: a file arrives with a CV source,
// an optional job board and a destination folder; text is taken from the
// PDF text layer or, when that layer is missing, from local Tesseract;
// fields are parsed; a dedupe hook runs; source fields are mapped for the
// Odoo adapter. Failures land in an error queue with a stable reason and
// can be retried. CV bytes and parsed text are never written to logs.
//
// Nothing in this module calls a paid API, linkedin.com, or Odoo. The Odoo
// adapter (built separately) implements source.Sink.
package ingest
