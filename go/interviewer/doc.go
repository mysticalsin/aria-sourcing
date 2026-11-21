// Package interviewer is Aria's hand-off adapter for Tony's voice screening service.
//
// A candidate is eligible only in the Odoo stage to_interview, with a recorded
// human approval and consent set to true. The adapter then POSTs a screening
// request and either polls or accepts a signed webhook. The recommendation on
// the resulting report is advisory: this package has no operation that rejects
// a candidate or changes an Odoo stage.
//
// # Feature flag
//
// ARIA_INTERVIEWER_ENABLED defaults off. ConfigFromEnv enables the adapter
// only for the exact values true, TRUE, True, and 1. While it is off, no
// request is sent and webhooks are ignored.
//
// # Environment
//
//	INTERVIEWER_BASE_URL      origin of the interviewer (https, or http on loopback)
//	INTERVIEWER_API_KEY       bearer token; never written to logs
//	INTERVIEWER_WEBHOOK_SECRET HMAC-SHA256 key for X-Interviewer-Signature
//	ARIA_INTERVIEWER_ENABLED  default false
//
// # Assumed screening contract
//
// The live interviewer at commit 369077cef402eea6df66f5a7e166e9a51dc252b1
// (branch feat/aria-fusion-multimodal-streaming) does not expose this façade.
// That tree's REST spine is the contract this adapter maps onto:
//
//	POST /interviews                         backend/src/api/interviews.py InterviewCreate
//	POST /interviews/{id}/start
//	POST /interviews/{id}/answer
//	POST /interviews/{id}/score
//	GET  /interviews/{id}/scorecard          competencies, overall, verdict
//	GET  /admin/interviews/{id}/report       backend/src/api/exports.py
//	GET  /health                             backend/src/main.py
//	statuses planned | active | completed | abandoned
//	recommendation enum                      backend/src/services/scoring.py
//	                                         strong_hire | hire | lean_hire | no_hire | strong_no_hire
//	verdicts Strong Qualify | Qualify | Borderline | Not Qualified
//	auth Authorization: Bearer               backend/src/api/dependencies.py
//	scorecard shape                          api-contract.md and scoring.py
//
// There is no webhook, no HMAC, and no idempotency key in that commit.
// This package therefore assumes a screening façade in front of that API:
//
//	POST {INTERVIEWER_BASE_URL}/v1/screenings
//	Authorization: Bearer ${INTERVIEWER_API_KEY}
//	Idempotency-Key: <digest>
//	{"need_summary","role_questions","candidate_id","language","consent":true}
//
//	GET {INTERVIEWER_BASE_URL}/v1/screenings/{id}
//	webhook body is the same JSON object, signed with HMAC-SHA256 over the raw bytes.
//
// Remote statuses map as planned/requested -> Requested, active/in_progress ->
// InProgress, completed -> Completed, failed/abandoned -> Failed, expired -> Expired.
// A completed payload may use either "scores" or the live "competencies" object.
// A transcript is stored only as interviews/{id}, never as transcript text.
//
// Timeouts are retried once and then returned as ErrInfra. They do not move
// the hand-off to Failed and they do not change the stage.
package interviewer
