#ifndef ARIA_CORE_H
#define ARIA_CORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Stable in-process ABI. Go calls these symbols through cgo.
   Version 1 is append-only: existing fields and codes do not change.
   Stage keys (index order), also returned by aria_stage_key:
   "to_rate" "to_assess" "to_interview" "shoot" "qm" "to_hire" "hired" "rejected" "withdrawn"
*/

#define ARIA_CORE_ABI_VERSION 1

#define ARIA_OK 0
#define ARIA_ERR_INVALID 1
#define ARIA_ERR_BUFFER 2
#define ARIA_ERR_UTF8 3
#define ARIA_ERR_TERMINAL 4
#define ARIA_ERR_REASON 5
#define ARIA_ERR_ILLEGAL 6
#define ARIA_ERR_PANIC 7

typedef struct AriaByteSpan {
    const uint8_t *data;
    size_t len;
} AriaByteSpan;

typedef struct AriaSpanList {
    const AriaByteSpan *items;
    size_t count;
} AriaSpanList;

typedef struct AriaCandidateIn {
    AriaByteSpan id;
    AriaSpanList tech_stack;
    double years_experience;
    int32_t years_known;
    AriaSpanList company_stage_experience;
    AriaSpanList industry_experience;
    AriaByteSpan location;
    AriaByteSpan timezone;
    AriaByteSpan recent_activity;
} AriaCandidateIn;

typedef struct AriaJobIn {
    AriaByteSpan location_type;
    AriaByteSpan location;
    AriaSpanList regions;
    AriaByteSpan timezone;
    AriaSpanList required_skills;
    AriaSpanList nice_to_have_skills;
    double min_years;
    int32_t has_min_years;
    double max_years;
    int32_t has_max_years;
    AriaSpanList company_stage_target;
    AriaSpanList industry_experience;
} AriaJobIn;

typedef struct AriaWeightsIn {
    double skills;
    double experience;
    double company_stage;
    double industry;
    double location;
    double activity;
} AriaWeightsIn;

typedef struct AriaIdentityIn {
    AriaByteSpan name;
    AriaByteSpan email;
    AriaByteSpan linkedin_url;
    AriaByteSpan github_url;
    AriaByteSpan source_url;
    AriaByteSpan current_company;
    AriaByteSpan last_contacted_at;
} AriaIdentityIn;

uint32_t aria_core_abi_version(void);
uint32_t aria_stage_count(void);
int32_t aria_stage_key(uint32_t index, char *buf, size_t cap);

/* out_scores and out_suggestion_only have length count.
   out_suggestion_only may be NULL. Every written flag is 1: ranking is a suggestion.
   weights may be NULL for the default weights. */
int32_t aria_score_batch(
    const AriaCandidateIn *candidates,
    size_t count,
    const AriaJobIn *job,
    const AriaWeightsIn *weights,
    double *out_scores,
    int32_t *out_suggestion_only);

/* NUL-terminated JSON: score, suggestionOnly, breakdown with fixed weight strings. */
int32_t aria_score_one_json(
    const AriaCandidateIn *candidate,
    const AriaJobIn *job,
    const AriaWeightsIn *weights,
    char *buf,
    size_t cap,
    size_t *out_len);

/* out_order[rank] = input index, best score first. Every index appears once. */
int32_t aria_rank_suggestions(const double *scores, size_t count, uint32_t *out_order);

/* out_accept[i] is 1 when incoming[i] is kept. Nobody is auto-rejected by score. */
int32_t aria_dedupe_batch(
    const AriaIdentityIn *incoming,
    size_t incoming_count,
    const AriaIdentityIn *existing,
    size_t existing_count,
    const AriaByteSpan *excluded_companies,
    size_t excluded_count,
    const uint8_t *current_company,
    size_t current_company_len,
    int64_t now_ms,
    uint32_t *out_accept);

/* out_entity[i] is the cluster root index. Empty keys do not merge records. */
int32_t aria_resolve_entities(const AriaIdentityIn *records, size_t count, uint32_t *out_entity);

/* Lowercase hex SHA-256, 64 chars plus a trailing NUL in out_hex[65]. */
int32_t aria_approval_hash(
    const uint8_t *channel,
    size_t channel_len,
    const uint8_t *recipient,
    size_t recipient_len,
    const uint8_t *subject,
    size_t subject_len,
    const uint8_t *body,
    size_t body_len,
    const uint8_t *notice,
    size_t notice_len,
    char out_hex[65]);

/* action is "advance", "reject", or "withdraw".
   Hired is reached only from to_hire when contract_id is non-empty and dna_integrated != 0.
   Otherwise an advance from to_hire stays there (out_stayed = 1, return ARIA_OK). */
int32_t aria_pipeline_transition(
    const char *stage,
    const char *action,
    const char *reason,
    const char *contract_id,
    int32_t dna_integrated,
    char *out_stage,
    size_t out_stage_cap,
    int32_t *out_stayed);

#ifdef __cplusplus
}
#endif

#endif /* ARIA_CORE_H */
