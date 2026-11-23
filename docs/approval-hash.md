# Approval hash

The approval digest is SHA-256 over one canonical preimage. Go (`services/internal/ledger`) and the Rust ledger use the same bytes. Shared vectors live in `docs/approval-hash-vectors.json`.

## Preimage

The encoding starts with the ASCII label `aria-approval-v1`, then a single NUL byte. Each field follows as an 8-byte big-endian length (the number of bytes in the field) and then those bytes, unchanged.

Field order:

1. channel
2. recipient ref
3. subject
4. body
5. notice version
6. applicant id

Bytes are not trimmed, case-folded, or Unicode-normalized. A change to any byte, including the applicant id, changes the digest. A grant for one applicant does not authorize another applicant, even when the message text matches.

The first five fields are the length-prefixed layout used by the Rust approval hash. The applicant id is the sixth field so the grant is bound to that applicant.
