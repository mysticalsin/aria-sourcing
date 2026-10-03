"use client";

import * as React from "react";
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
import { useActions, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import type { CandidateLawfulBasis } from "@/lib/types";
import { UserPlus } from "lucide-react";

/**
 * Manual candidate intake for a campaign's Candidates tab: hand Aria a
 * specific person (a GitHub username, or fully manual fields) instead of a
 * search. Gated behind the same "source" permission as sourcing itself.
 * Never drafts or sends outreach — the new candidate lands as any other
 * sourced profile does, in "Sourced".
 */
export function AddCandidateButton({ campaignId }: { campaignId: string }) {
  const actions = useActions();
  const role = useRole();
  const { toast } = useToast();
  const idBase = React.useId();

  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"github" | "manual">("github");
  const [ghLoading, setGhLoading] = React.useState(false);

  const [username, setUsername] = React.useState("");

  const [name, setName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [skills, setSkills] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [profileUrl, setProfileUrl] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lawfulBasis, setLawfulBasis] = React.useState<CandidateLawfulBasis | "">("");

  if (!can(role, "source")) return null;

  function resetAndClose() {
    setUsername("");
    setName("");
    setTitle("");
    setSkills("");
    setEmail("");
    setProfileUrl("");
    setLocation("");
    setNotes("");
    setLawfulBasis("");
    setMode("github");
    setOpen(false);
  }

  async function handleGithubSubmit() {
    const login = username.trim().replace(/^@/, "");
    if (!login) {
      toast({ title: "Enter a GitHub username", variant: "warning" });
      return;
    }
    setGhLoading(true);
    const res = await actions.addCandidateFromGithub(campaignId, login);
    setGhLoading(false);
    if (!res.ok) {
      toast({ title: "Couldn't add that profile", description: res.error, variant: "error" });
      return;
    }
    if (res.added === 0) {
      toast({
        title: "Profile not added",
        description: res.skipReason ?? "The profile did not pass candidate intake checks.",
        variant: "warning",
      });
      return;
    }
    toast({ title: `Added @${login}`, description: "Scored and placed in Sourced.", variant: "success" });
    resetAndClose();
  }

  async function handleManualSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({ title: "Name is required", variant: "warning" });
      return;
    }
    const res = await actions.addCandidateManual(campaignId, {
      name: trimmedName,
      title: title.trim() || undefined,
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      profileUrl: profileUrl.trim() || undefined,
      email: email.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      lawfulBasis: lawfulBasis as CandidateLawfulBasis,
    });
    if (!res.ok) {
      toast({ title: "Couldn't add that candidate", description: res.error, variant: "error" });
      return;
    }
    if (res.added === 0) {
      toast({
        title: "Candidate not added",
        description: res.skipReason ?? "The candidate did not pass intake checks.",
        variant: "warning",
      });
      return;
    }
    toast({ title: `Added ${trimmedName}`, description: "Scored and placed in Sourced.", variant: "success" });
    resetAndClose();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        leftIcon={<UserPlus className="h-4 w-4" />}
        onClick={() => setOpen(true)}
      >
        Add candidate
      </Button>
      <Modal
        open={open}
        onClose={resetAndClose}
        title="Add a candidate"
        description="Hand Aria a specific person instead of a search. Never drafts or sends outreach on its own."
        footer={
          mode === "github" ? (
            <>
              <Button variant="ghost" size="md" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={handleGithubSubmit}
                loading={ghLoading}
                disabled={ghLoading || !username.trim()}
              >
                Look up &amp; add
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="md" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={handleManualSubmit}
                disabled={!name.trim() || !lawfulBasis}
              >
                Add candidate
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          <Tabs
            idBase={idBase}
            items={[
              { value: "github", label: "GitHub username" },
              { value: "manual", label: "Manual" },
            ]}
            value={mode}
            onValueChange={(v) => setMode(v as "github" | "manual")}
          />

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
            <div className="space-y-4">
              <Field label="Name" htmlFor={`${idBase}-name`}>
                <Input
                  id={`${idBase}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Rivera"
                  autoComplete="off"
                  maxLength={200}
                />
              </Field>
              <Field label="Title" htmlFor={`${idBase}-title`} hint="Optional.">
                <Input
                  id={`${idBase}-title`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Senior Backend Engineer"
                  autoComplete="off"
                  maxLength={200}
                />
              </Field>
              <Field label="Skills" htmlFor={`${idBase}-skills`} hint="Comma-separated, optional.">
                <Input
                  id={`${idBase}-skills`}
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  placeholder="Go, Kubernetes, PostgreSQL"
                  autoComplete="off"
                  maxLength={3_029}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" htmlFor={`${idBase}-email`} hint="Optional.">
                  <Input
                    id={`${idBase}-email`}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jordan@example.com"
                    autoComplete="off"
                    maxLength={254}
                  />
                </Field>
                <Field label="Location" htmlFor={`${idBase}-location`} hint="Optional.">
                  <Input
                    id={`${idBase}-location`}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Berlin, DE"
                    autoComplete="off"
                    maxLength={200}
                  />
                </Field>
              </div>
              <Field label="Profile URL" htmlFor={`${idBase}-url`} hint="LinkedIn, portfolio, anywhere. Optional.">
                <Input
                  id={`${idBase}-url`}
                  value={profileUrl}
                  onChange={(e) => setProfileUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/..."
                  autoComplete="off"
                  maxLength={2_048}
                />
              </Field>
              <Field label="Notes" htmlFor={`${idBase}-notes`} hint="Optional recruiter note.">
                <Textarea
                  id={`${idBase}-notes`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2_000}
                />
              </Field>
              <Field
                label="Lawful basis"
                htmlFor={`${idBase}-lawful-basis`}
                hint="Required operator selection. Aria records your choice but does not make the legal determination."
              >
                <Select
                  id={`${idBase}-lawful-basis`}
                  value={lawfulBasis}
                  onChange={(event) =>
                    setLawfulBasis(event.target.value as CandidateLawfulBasis | "")
                  }
                  options={[
                    { value: "", label: "Select a basis…" },
                    { value: "consent", label: "Consent" },
                    { value: "legitimate_interest", label: "Legitimate interest" },
                  ]}
                  required
                />
              </Field>
            </div>
          </TabPanel>
        </div>
      </Modal>
    </>
  );
}
