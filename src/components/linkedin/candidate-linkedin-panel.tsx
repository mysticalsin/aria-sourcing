"use client";

import { Linkedin } from "lucide-react";
import { isPublicLinkedInProfileUrl } from "@/lib/sourcing/web-leads";
import type { Candidate } from "@/lib/types";

/**
 * Public LinkedIn facts on a candidate. Location and skills come from the
 * result text. Outreach stays assisted-manual unless Recruiter System Connect
 * is connected. This panel does not talk to a browser extension or cookies.
 */
export function CandidateLinkedInPanel({
  candidate,
  masked,
  recruiterConnected,
}: {
  candidate: Pick<Candidate, "location" | "currentTitle" | "techStack" | "linkedinUrl" | "sourcePlatform" | "sourceQuery">;
  masked: boolean;
  recruiterConnected: boolean;
}) {
  const skills = candidate.techStack.filter(Boolean);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label="LinkedIn">
      <div className="flex flex-wrap items-center gap-2">
        <Linkedin className="h-4 w-4 text-[#0a66c2]" aria-hidden />
        <h3 className="text-sm font-semibold text-ink">LinkedIn</h3>
        <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs font-semibold text-ink-soft">
          {recruiterConnected ? "Recruiter System Connect" : "Public results"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">
        Sourcing uses public results or official Recruiter System Connect. Sending stays assisted-manual unless that official connection is on.
      </p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Role</dt>
          <dd className="text-ink">{candidate.currentTitle || "No role stated"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Location</dt>
          <dd className="text-ink">{candidate.location || "No place stated"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Brief skills in the public text</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {skills.length === 0 ? (
              <span className="text-ink-soft">None observed</span>
            ) : (
              skills.map((skill) => (
                <span key={skill} className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs font-semibold text-ink">
                  {skill}
                </span>
              ))
            )}
          </dd>
        </div>
      </dl>
      {candidate.linkedinUrl && !masked && isPublicLinkedInProfileUrl(candidate.linkedinUrl) ? (
        <a
          href={candidate.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex text-sm font-semibold text-[#0a66c2] hover:underline"
        >
          Open public profile
        </a>
      ) : null}
      {candidate.sourceQuery ? (
        <p className="mt-2 text-xs text-muted">Query: {candidate.sourceQuery}</p>
      ) : null}
    </section>
  );
}
