-- LinkedIn bridge inbox UI: what the user has already seen in ARIA, and who
-- wrote the latest message (so ARIA can announce new replies, not echoes of
-- the user's own sends). Table privileges from 0006 cover the new columns.
alter table public.linkedin_bridge_conversations
  add column seen_at timestamptz,
  add column last_message_direction text check (last_message_direction in ('inbound', 'outbound')),
  add column last_message_sender text check (char_length(last_message_sender) <= 200);
