"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import { useActions, useActiveCampaign, useCampaigns, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { campaignAllowsManualCandidateIntake } from "@/lib/sourcing/campaign-lifecycle";
import { publicIdFromProfileUrl } from "@/lib/linkedin-profile-url";
import type { CandidateLawfulBasis } from "@/lib/types";
import { Linkedin, UserPlus } from "lucide-react";

type Mode = "linkedin" | "github" | "manual";

/**
 * Manual candidate intake: hand Aria a specific person instead of a search.
 * From a LinkedIn profile URL the recruiter already has, a GitHub username,
 * or typed fields. Aria does not look the profile up on LinkedIn. Gated behind the
 * same "source" permission as sourcing itself. Never drafts or sends
 * outreach: the new candidate lands in "Sourced".
 */
export function AddCandidateButton({ campaignId }: { campaignId?: string }) {
  const actions = useActions();
  const role = useRole();
  const router = useRouter();
  const { toast } = useToast();
  const idBase = React.useId();
  const campaigns = useCampaigns();
  const activeCampaign = useActiveCampaign();

  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("linkedin");
  const [busy, setBusy] = React.useState(false);
  const [targetCampaign, setTargetCampaign] = React.useState("");

  const [username, setUsername] = React.useState("");

  const [linkedinUrl, setLinkedinUrl] = React.useState("");

  const [name, setName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [skills, setSkills] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [profileUrl, setProfileUrl] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lawfulBasis, setLawfulBasis] = React.useState<CandidateLawfulBasis | "">("");

  const eligible = React.useMemo(() => campaigns.filter((c) => campaignAllowsManualCandidateIntake(c.status)), [campaigns]);
  const chosenCampaign = campaignId ?? targetCampaign;

  if (!can(role, "source")) return null;

  function openDialog() {
    setTargetCampaign(
      eligible.find((c) => c.id === activeCampaign?.id)?.id ?? eligible[0]?.id ?? "",
    );
    setOpen(true);
  }

  function reset() {
    setUsername("");
    setLinkedinUrl("");
    setName("");
    setTitle("");
    setCompany("");
    setSkills("");
    setEmail("");
    setProfileUrl("");
    setLocation("");
    setNotes("");
    setLawfulBasis("");
    setMode("linkedin");
  }

  function cancel() {
    reset();
    setOpen(false);
  }

  const linkedinId = publicIdFromProfileUrl(linkedinUrl);

  function intakeFailed(res: { ok: true; added: number; skipReason?: string } | { ok: false; error: string }): boolean {
    if (!res.ok) {
      toast({ title: "Couldn't add that candidate", description: res.error, variant: "error" });
      return true;
    }
    if (res.added === 0) {
      toast({
        title: "Candidate not added",
        description: res.skipReason ?? "The candidate did not pass intake checks.",
        variant: "warning",
      });
      return true;
    }
    return false;
  }

  async function handleGithubSubmit() {
    const login = username.trim().replace(/^@/, "");
    if (!login || !chosenCampaign) return;
    setBusy(true);
    const res = await actions.addCandidateFromGithub(chosenCampaign, login);
    setBusy(false);
    if (intakeFailed(res)) return;
    toast({ title: `Added @${login}`, description: "Scored and placed in Sourced.", variant: "success" });
    reset();
    setOpen(false);
  }

  async function handleTypedSubmit(fromLinkedIn: boolean) {
    const trimmedName = name.trim();
    if (!trimmedName || !chosenCampaign || !lawfulBasis) return;
    setBusy(true);
    const res = await actions.addCandidateManual(chosenCampaign, {
      name: trimmedName,
      title: title.trim() || undefined,
      company: company.trim() || undefined,
      linkedinUrl: fromLinkedIn ? linkedinUrl.trim() : undefined,
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      profileUrl: fromLinkedIn ? undefined : profileUrl.trim() || undefined,
      email: email.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      lawfulBasis,
    });
    if (intakeFailed(res)) {
      setBusy(false);
      return;
    }
    const candidateId = res.ok ? res.candidateIds?.[0] : undefined;
    setBusy(false);
    toast({ title: `Added ${trimmedName}`, description: "Scored and placed in Sourced.", variant: "success" });
    reset();
    setOpen(false);
    if (candidateId) router.push(`/candidates?focus=${encodeURIComponent(candidateId)}&added=1${fromLinkedIn ? "&tab=linkedin" : ""}`);
  }

  const campaignField = !campaignId && (
    <Field
      label="Campaign"
      htmlFor={`${idBase}-campaign`}
      hint={eligible.length ? undefined : "No campaign accepts new candidates (paused or filled)."}
    >
      <Select
        id={`${idBase}-campaign`}
        value={targetCampaign}
        onChange={(e) => setTargetCampaign(e.target.value)}
        options={eligible.length ? eligible.map((c) => ({ value: c.id, label: c.title })) : [{ value: "", label: "No open campaign" }]}
      />
    </Field>
  );

  const lawfulBasisField = (scope: string) => (
    <Field
      label="Lawful basis"
      htmlFor={`${idBase}-${scope}-lawful-basis`}
      hint="Required operator selection. Aria records your choice but does not make the legal determination."
    >
      <Select
        id={`${idBase}-${scope}-lawful-basis`}
        value={lawfulBasis}
        onChange={(event) => setLawfulBasis(event.target.value as CandidateLawfulBasis | "")}
        options={[
          { value: "", label: "Select a basis…" },
          { value: "consent", label: "Consent" },
          { value: "legitimate_interest", label: "Legitimate interest" },
        ]}
        required
      />
    </Field>
  );

  const personFields = (scope: "linkedin" | "manual") => (
    <div className="space-y-4">
      <Field label="Name" htmlFor={`${idBase}-${scope}-name`}>
        <Input id={`${idBase}-${scope}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Rivera" autoComplete="off" maxLength={200} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor={`${idBase}-${scope}-title`} hint="Optional.">
          <Input id={`${idBase}-${scope}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Backend Engineer" autoComplete="off" maxLength={200} />
        </Field>
        <Field label="Company" htmlFor={`${idBase}-${scope}-company`} hint="Optional.">
          <Input id={`${idBase}-${scope}-company`} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" autoComplete="off" maxLength={200} />
        </Field>
      </div>
      <Field label="Skills" htmlFor={`${idBase}-${scope}-skills`} hint="Comma-separated, optional. Only skills you saw on the profile.">
        <Input id={`${idBase}-${scope}-skills`} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Go, Kubernetes, PostgreSQL" autoComplete="off" maxLength={3_029} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor={`${idBase}-${scope}-email`} hint="Optional.">
          <Input id={`${idBase}-${scope}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" autoComplete="off" maxLength={254} />
        </Field>
        <Field label="Location" htmlFor={`${idBase}-${scope}-location`} hint="Optional.">
          <Input id={`${idBase}-${scope}-location`} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Paris, FR" autoComplete="off" maxLength={200} />
        </Field>
      </div>
      {scope === "manual" && (
        <Field label="Profile URL" htmlFor={`${idBase}-${scope}-url`} hint="LinkedIn, portfolio, anywhere. Optional.">
          <Input id={`${idBase}-${scope}-url`} value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://..." autoComplete="off" maxLength={2_048} />
        </Field>
      )}
      <Field label="Notes" htmlFor={`${idBase}-${scope}-notes`} hint="Optional recruiter note, e.g. how you know them.">
        <Textarea id={`${idBase}-${scope}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2_000} />
      </Field>
      {lawfulBasisField(scope)}
    </div>
  );

  const canSubmitTyped = Boolean(name.trim() && lawfulBasis && chosenCampaign);
  const footer =
    mode === "github" ? (
      <>
        <Button variant="ghost" size="md" onClick={cancel}>Cancel</Button>
        <Button variant="secondary" size="md" onClick={handleGithubSubmit} loading={busy} disabled={busy || !username.trim() || !chosenCampaign}>
          Look up &amp; add
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" size="md" onClick={cancel}>Cancel</Button>
        <Button
          variant="secondary"
          size="md"
          onClick={() => handleTypedSubmit(mode === "linkedin")}
          loading={busy}
          disabled={busy || !canSubmitTyped || (mode === "linkedin" && !linkedinId)}
        >
          Add candidate
        </Button>
      </>
    );

  return (
    <>
      <Button variant="outline" size="sm" leftIcon={<UserPlus className="h-4 w-4" />} onClick={openDialog}>
        Add candidate
      </Button>
      <Modal
        open={open}
        onClose={cancel}
        title="Add a candidate"
        description="Someone you already have in mind, instead of a search. Never drafts or sends outreach on its own."
        footer={footer}
        className="max-w-2xl"
      >
        <div className="space-y-4">
          {campaignField}
          <Tabs
            idBase={idBase}
            label="How to add the candidate"
            items={[
              { value: "linkedin", label: "LinkedIn profile", icon: <Linkedin className="h-4 w-4" /> },
              { value: "github", label: "GitHub username" },
              { value: "manual", label: "Manual" },
            ]}
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
          />

          <TabPanel value="linkedin" active={mode === "linkedin"} idBase={idBase}>
            <Field
              label="LinkedIn profile URL"
              htmlFor={`${idBase}-li-url`}
              hint="A URL you already have. Aria stores it and does not open LinkedIn."
            >
              <Input
                id={`${idBase}-li-url`}
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://www.linkedin.com/in/jane-doe"
                autoComplete="off"
                maxLength={500}
              />
            </Field>
          </TabPanel>

          <TabPanel value="github" active={mode === "github"} idBase={idBase}>
            <Field
              label="GitHub username"
              htmlFor={`${idBase}-username`}
              hint="Looks up the real public profile via the GitHub API. No search, just this one person."
            >
              <Input
                id={`${idBase}-username`}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="octocat"
                autoComplete="off"
                maxLength={39}
              />
            </Field>
          </TabPanel>

          <TabPanel value="manual" active={mode === "manual"} idBase={idBase}>
            <p className="text-sm text-muted">Type the person yourself. Nothing is fetched from LinkedIn.</p>
          </TabPanel>
          {mode !== "github" && personFields(mode === "linkedin" ? "linkedin" : "manual")}
        </div>
      </Modal>
    </>
  );
}
