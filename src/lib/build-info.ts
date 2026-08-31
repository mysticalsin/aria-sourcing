/** Baked at `next build` from NEXT_PUBLIC_ARIA_GIT_SHA / ARIA_RELEASE_SHA / GITHUB_SHA. */
export function ariaBuildSha(): string {
  return (process.env.NEXT_PUBLIC_ARIA_GIT_SHA ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase().slice(0, 40);
}

/**
 * `/api/ready`.build must be the SHA that actually runs. A leftover Fly
 * `ARIA_RELEASE_SHA` secret (PR 53 stamped 7fe6702 after an image rollback)
 * must not outrank a 40-character SHA baked into the image.
 */
export function ariaReleaseIdentitySha(
  env: Record<string, string | undefined> = process.env,
): string {
  const baked = (env.NEXT_PUBLIC_ARIA_GIT_SHA ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (/^[0-9a-f]{40}$/.test(baked)) return baked;
  const stamped = (env.ARIA_RELEASE_SHA ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase();
  return /^[0-9a-f]{40}$/.test(stamped) ? stamped : "";
}

export function ariaBuildLabel(): string {
  const sha = ariaBuildSha();
  return sha ? sha.slice(0, 12) : "unreleased";
}
