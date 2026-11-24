"use client";

import * as React from "react";
import type { Candidate } from "@/lib/types";
import { candidatePhotoUrl } from "@/lib/candidate-photo";
import { cn, initialsFrom } from "@/lib/utils";

const SIZES = { sm: "h-8 w-8 text-[11px]", md: "h-10 w-10 text-xs", lg: "h-14 w-14 text-base" } as const;

/**
 * Profile photo with the initials as fallback. Pass the candidate AFTER
 * applyConfidentiality: a masked candidate carries no avatarUrl, so only the
 * masked initials show. LinkedIn photo URLs are signed and expire; a failed
 * load falls back to the initials instead of a broken image. Decorative: the
 * name next to it carries the identity.
 */
export function CandidateAvatar({ candidate, size = "sm", className }: {
  candidate: Pick<Candidate, "name" | "avatarInitials" | "avatarUrl">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const src = candidatePhotoUrl(candidate.avatarUrl);
  const [failed, setFailed] = React.useState<string | null>(null);
  const showPhoto = Boolean(src) && failed !== src;
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink/[0.06] font-bold text-ink-soft", SIZES[size], className)}
      aria-hidden
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(src)}
        />
      ) : (
        candidate.avatarInitials || initialsFrom(candidate.name)
      )}
    </span>
  );
}
