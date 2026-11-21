// Package router is Aria's token-saving model router.
//
// A request is decided in this order: a content-addressed prompt cache,
// deterministic rules and templates, a small model, then a big model only
// when the small model's confidence is below the threshold or the request
// is complex (a shortlisted draft). This module ships fake providers only.
// It never opens a network connection and it never keeps or logs API-key
// values. Budget amounts are read from the named environment variables and
// are not written to logs.
//
// The request state machine is:
//
//	received -> rule_hit | small_model -> escalated -> big_model -> cached -> done
//	         \-> budget_exceeded
//
// A cache hit takes received -> cached -> done and does not call a provider.
package router
