/**
 * Unit tests for obscura-adapter.ts's session-expiry logic. No live sidecar
 * needed: isSessionExpired is a pure function of (openedAt, lastActivityAt, now).
 * Actually opening/closing a real session against the sidecar is covered by
 * tests/obscura-integration.mts (run separately via `npm run test:obscura`).
 */
import { isSessionExpired, IDLE_TIMEOUT_MS, HARD_TIMEOUT_MS, _debugSessionCount } from "../src/lib/ai/obscura-adapter";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name, extra ?? "");
  }
}

const now = 1_000_000_000; // arbitrary fixed epoch ms, avoids Date.now() in test logic

ok("no sessions before anything opens one", _debugSessionCount() === 0);

ok(
  "a brand-new session is not expired",
  !isSessionExpired({ openedAt: now, lastActivityAt: now }, now),
);

ok(
  "just under the idle timeout is not expired",
  !isSessionExpired({ openedAt: now, lastActivityAt: now - (IDLE_TIMEOUT_MS - 1) }, now),
);

ok(
  "just over the idle timeout is expired",
  isSessionExpired({ openedAt: now, lastActivityAt: now - (IDLE_TIMEOUT_MS + 1) }, now),
);

ok(
  "recently active but past the hard cap is still expired",
  isSessionExpired({ openedAt: now - (HARD_TIMEOUT_MS + 1), lastActivityAt: now }, now),
);

ok(
  "just under the hard cap, freshly touched, is not expired",
  !isSessionExpired({ openedAt: now - (HARD_TIMEOUT_MS - 1), lastActivityAt: now }, now),
);

ok("hard timeout is longer than idle timeout", HARD_TIMEOUT_MS > IDLE_TIMEOUT_MS);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
