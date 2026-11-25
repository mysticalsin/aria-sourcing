//! Approval-ledger hash.
//!
//! The hashed bytes are a canonical encoding of the exact text the operator
//! (or the QC pass) approved: channel, recipient ref, subject, body, and
//! notice version. Field bytes are not trimmed, case-folded, or Unicode-normalized.
//! Length prefixes make the encoding unambiguous, so two different messages
//! cannot share a hash by sliding a boundary.
//!
//! Any change to those bytes changes the SHA-256. An edit voids the approval.

use sha2::{Digest, Sha256};

pub const CANONICAL_VERSION: &[u8] = b"aria-approval-v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApprovalText<'a> {
    pub channel: &'a [u8],
    pub recipient_ref: &'a [u8],
    pub subject: &'a [u8],
    pub body: &'a [u8],
    pub notice_version: &'a [u8],
}

/// Canonical byte layout:
/// `aria-approval-v1` NUL, then each field as a big-endian u64 length plus its raw bytes.
/// Field order matches the values PR #167 binds: channel, recipient, subject, body,
/// then notice version. Length prefixes stop a newline inside one field from
/// sliding into the next field.
pub fn canonical_bytes(text: &ApprovalText<'_>) -> Vec<u8> {
    let fields = [
        text.channel,
        text.recipient_ref,
        text.subject,
        text.body,
        text.notice_version,
    ];
    let size =
        CANONICAL_VERSION.len() + 1 + fields.iter().map(|field| 8 + field.len()).sum::<usize>();
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(CANONICAL_VERSION);
    out.push(0);
    for field in fields {
        out.extend_from_slice(&(field.len() as u64).to_be_bytes());
        out.extend_from_slice(field);
    }
    out
}

pub fn approval_hash(text: &ApprovalText<'_>) -> [u8; 32] {
    let digest = Sha256::digest(canonical_bytes(text));
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

pub fn approval_hash_hex(text: &ApprovalText<'_>) -> String {
    to_hex(&approval_hash(text))
}

pub fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
