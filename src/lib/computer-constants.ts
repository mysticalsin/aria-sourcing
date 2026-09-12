/**
 * Shared computer/seat constants safe for client + server imports.
 * Keep this module free of node:fs, next/headers, and supervisor clients.
 */

/** Seat id used when a host VM is unbound from any agent desk. */
export const HOST_ORPHAN_SEAT_ID = "__orphan__";
