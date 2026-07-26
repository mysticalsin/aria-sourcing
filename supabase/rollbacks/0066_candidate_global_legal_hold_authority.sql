-- 0066 closes a known destructive cross-campaign legal-hold bypass.
-- Downgrade is never safe, including on an empty tenant. A reversal must be a
-- separately reviewed forward migration with its own concurrency proof.
do $candidate_global_hold_rollback_refusal$
begin
  raise exception
    '0066 candidate-global legal-hold authority cannot be rolled back; use a reviewed forward reversal migration'
    using errcode = '55000';
end
$candidate_global_hold_rollback_refusal$;
