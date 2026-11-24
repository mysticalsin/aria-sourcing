"use client";

import * as React from "react";
import { AlertTriangle, Check, Clock, ExternalLink, Linkedin, Loader2, Search, UserPlus } from "lucide-react";
import { Button, Field, Input, useToast } from "@/components/ui";
import { publicIdFromProfileUrl } from "@/lib/linkedin-profile-url";
import { adoptProspect, discardProspect, previewProspect, useCandidateLinkedIn } from "./linkedin-store";
import { useBridgeExtension } from "./use-bridge-extension";

const SETTINGS_HREF = "/settings?tab=integrations#linkedin";

/** "Senior Engineer at Acme | Cloud" -> title and company, when the headline says so. */
export function splitHeadline(headline: string): { title: string; company: string } {
  const first = headline.split(/\s+[|·•]\s+/)[0]?.trim() ?? "";
  const at = /^(.+?)\s+(?:at|chez|@)\s+(.+)$/i.exec(first);
  return at ? { title: at[1].trim(), company: at[2].trim() } : { title: first, company: "" };
}

export function linkedInPeopleSearchUrl(keywords: string): string {
  const q = keywords.trim();
  return q
    ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`
    : "https://www.linkedin.com/search/results/people/";
}

/** The looked-up profile became this candidate: its LinkedIn standing carries over. */
export function keepProspectAs(prospectId: string, candidateId: string) {
  return adoptProspect(prospectId, candidateId);
}

/** The looked-up profile was not added: forget it. */
export function forgetProspect(prospectId: string) {
  void discardProspect(prospectId);
}

export type LookedUpProfile = { name: string; title: string; company: string };

/**
 * Find someone on LinkedIn and read their profile through the user's own
 * LinkedIn (the ARIA extension), before adding them as a candidate: search
 * link (a new LinkedIn tab, the user picks the person), profile URL, and what
 * LinkedIn says (name, headline, connection). The look-up is a click; it
 * counts as one profile view.
 */
export function LinkedInProfileLookup({
  idBase,
  url,
  onUrlChange,
  prospectId,
  onProspectChange,
  onProfile,
}: {
  idBase: string;
  url: string;
  onUrlChange: (url: string) => void;
  prospectId: string | null;
  onProspectChange: (prospectId: string | null) => void;
  /** Called once per LinkedIn answer, to prefill the form. */
  onProfile: (profile: LookedUpProfile) => void;
}) {
  const { toast } = useToast();
  const [searchText, setSearchText] = React.useState("");
  const [looking, setLooking] = React.useState(false);
  const { state, contact } = useCandidateLinkedIn(prospectId ?? "");
  const paired = state.status === "ready" && Boolean(state.account?.paired);
  const { nudge } = useBridgeExtension(paired);
  const valid = Boolean(publicIdFromProfileUrl(url));

  const onProfileRef = React.useRef(onProfile);
  React.useEffect(() => {
    onProfileRef.current = onProfile;
  }, [onProfile]);
  const answered = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!contact || contact.checking || !contact.displayName) return;
    const key = `${prospectId}:${contact.checkedAt}`;
    if (answered.current === key) return;
    answered.current = key;
    onProfileRef.current({ name: contact.displayName, ...splitHeadline(contact.headline ?? "") });
  }, [contact, prospectId]);

  async function lookUp() {
    if (!valid) return;
    setLooking(true);
    const res = await previewProspect(url.trim());
    setLooking(false);
    if (!res.ok) {
      toast({ title: "LinkedIn", description: res.error, variant: "error" });
      return;
    }
    if (prospectId && prospectId !== res.data.prospectId) forgetProspect(prospectId);
    answered.current = null;
    onProspectChange(res.data.prospectId);
    nudge();
  }

  let preview: React.ReactNode = null;
  if (state.status === "disabled" || (state.status === "ready" && !paired)) {
    preview = (
      <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted">
        {state.status === "disabled" ? (
          "The LinkedIn bridge is off: fill in the details below."
        ) : (
          <>
            <a href={SETTINGS_HREF} className="font-semibold text-[#0a66c2] underline-offset-2 hover:underline">
              Connect your LinkedIn
            </a>{" "}
            to fill this in from the profile and see whether you are connected. Or type the details below.
          </>
        )}
      </p>
    );
  } else if (prospectId) {
    const checking = !contact || contact.checking;
    preview = (
      <div className="flex items-start gap-3 rounded-xl border border-line bg-ink/[0.02] p-3" data-prospect-preview>
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0a66c2]/10 text-[#0a66c2]">
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Linkedin className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          {checking ? (
            <p className="text-muted">
              Reading the profile from your LinkedIn…
              {state.account?.account?.online ? "" : " (waiting for the ARIA extension in Chrome)"}
            </p>
          ) : contact.relationship === "not_found" ? (
            <p className="flex items-center gap-1.5 text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden /> LinkedIn does not know this profile. Check the URL.
            </p>
          ) : (
            <>
              <p className="font-semibold text-ink">{contact.displayName}</p>
              {contact.headline && <p className="text-muted">{contact.headline}</p>}
              <p className="mt-1.5 text-xs font-semibold">
                {contact.relationship === "connected" ? (
                  <span className="inline-flex items-center gap-1 text-[#0a66c2]">
                    <Check className="h-3.5 w-3.5" aria-hidden /> 1st-degree connection: you can message them once added
                  </span>
                ) : contact.relationship === "pending" ? (
                  <span className="inline-flex items-center gap-1 text-[hsl(32_90%_34%)]">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> Invitation pending
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-ink-soft">
                    <UserPlus className="h-3.5 w-3.5" aria-hidden /> Not connected: you can invite them once added
                  </span>
                )}
              </p>
            </>
          )}
          {contact?.lookupError && !checking && contact.relationship !== "not_found" && (
            <p className="mt-1 text-xs text-danger">{contact.lookupError}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Field
        label="Find them on LinkedIn"
        htmlFor={`${idBase}-search`}
        hint="Opens LinkedIn's people search in a new tab. Open their profile there and copy its address."
      >
        <div className="flex gap-2">
          <Input
            id={`${idBase}-search`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Name, company"
            autoComplete="off"
            maxLength={200}
          />
          <a
            href={linkedInPeopleSearchUrl(searchText)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-sm font-semibold text-[#0a66c2] hover:bg-[#0a66c2]/[0.06]"
          >
            <Search className="h-4 w-4" aria-hidden /> Search <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </Field>
      <Field label="LinkedIn profile URL" htmlFor={`${idBase}-linkedin`}>
        <div className="flex gap-2">
          <Input
            id={`${idBase}-linkedin`}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && paired) {
                e.preventDefault();
                void lookUp();
              }
            }}
            placeholder="https://www.linkedin.com/in/jane-doe"
            autoComplete="off"
            maxLength={500}
          />
          {paired && (
            <Button variant="outline" size="md" onClick={() => void lookUp()} loading={looking} disabled={looking || !valid}>
              Look up
            </Button>
          )}
        </div>
      </Field>
      {preview}
    </div>
  );
}
