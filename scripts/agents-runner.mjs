#!/usr/bin/env node
/* The agents runner no longer ticks. It used to POST /api/agent/tick, which
   queued LinkedIn messages without a per-message approval. That autopilot is
   removed. This process stays up so an old Compose service does not crash-loop,
   and it never calls the app. */

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

console.log(JSON.stringify({
  at: new Date().toISOString(),
  event: "disabled",
  reason: "The LinkedIn autopilot runner is removed and does not call the app.",
}));

while (!stopping) {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}
