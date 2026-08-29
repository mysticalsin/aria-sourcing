"use client";

import * as React from "react";
import { Card, CardContent, Badge, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useActions, useRole } from "@/lib/store";
import { ROLES, type Role } from "@/lib/types";
import { can, ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import { ShieldCheck, UserCog, Eye, Check, Bot } from "lucide-react";

const ICON: Record<Role, React.ReactNode> = {
  admin: <ShieldCheck className="h-4 w-4" />,
  member: <UserCog className="h-4 w-4" />,
  viewer: <Eye className="h-4 w-4" />,
};

type MemberRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  autopilot_enabled: boolean;
  autopilot_updated_at: string | null;
};

export function RolesPanel() {
  const role = useRole();
  const actions = useActions();
  const { toast } = useToast();
  const [members, setMembers] = React.useState<MemberRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const loadMembers = React.useCallback(async () => {
    if (!supabaseEnabled || !can(role, "manage_autopilot")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/members", { method: "GET", credentials: "same-origin" });
      const json = (await res.json()) as { ok?: boolean; members?: MemberRow[]; error?: string };
      if (!res.ok || !json.ok || !Array.isArray(json.members)) {
        toast({
          title: "Could not load members",
          description: json.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      setMembers(json.members);
    } catch (error) {
      toast({
        title: "Could not load members",
        description: error instanceof Error ? error.message : "Network error",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [role, toast]);

  React.useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function toggleAutopilot(member: MemberRow, enabled: boolean) {
    if (member.role === "viewer" && enabled) {
      toast({
        title: "Viewers cannot use autopilot",
        description: "Promote the teammate to member or admin first.",
        variant: "error",
      });
      return;
    }
    setBusyId(member.id);
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.id, autopilotEnabled: enabled }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({
          title: "Autopilot update failed",
          description: json.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      setMembers((rows) =>
        rows.map((row) =>
          row.id === member.id ? { ...row, autopilot_enabled: enabled } : row,
        ),
      );
      toast({
        title: enabled ? "Autopilot enabled" : "Autopilot disabled",
        description: member.email ?? member.id,
        variant: "info",
      });
    } catch (error) {
      toast({
        title: "Autopilot update failed",
        description: error instanceof Error ? error.message : "Network error",
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (supabaseEnabled) {
    return (
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4">
            <span className="flex items-center gap-2 font-bold text-ink">
              {ICON[role]}
              {ROLE_LABEL[role]}
            </span>
            <Badge tone="electric" size="sm">
              <Check className="h-3 w-3" /> current
            </Badge>
          </div>
          <p className="text-xs text-muted">
            This access level is assigned to your signed-in profile. An administrator changes teammate
            roles in the identity directory, not in shared workspace settings. Autopilot is a separate
            admin toggle: when ON (and Sequences armed on the switchboard), critics-green first-touch
            drafts auto-queue Email / WhatsApp / LinkedIn (HeyReach). When OFF, shortlist/template/reply
            paths still need human Approve → Send.
          </p>

          {can(role, "manage_autopilot") ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Bot className="h-4 w-4" />
                Autopilot entitlements
              </div>
              {loading && <p className="text-xs text-muted">Loading teammates…</p>}
              {!loading && members.length === 0 && (
                <p className="text-xs text-muted">No workspace members found.</p>
              )}
              <ul className="space-y-2">
                {members.map((member) => {
                  const label = member.full_name || member.email || member.id;
                  const disabled = busyId === member.id || member.role === "viewer";
                  return (
                    <li
                      key={member.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{label}</div>
                        <div className="text-xs text-muted">
                          {ROLE_LABEL[member.role] ?? member.role}
                          {member.email ? ` · ${member.email}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={member.autopilot_enabled}
                        onClick={() => void toggleAutopilot(member, !member.autopilot_enabled)}
                        className={cn(
                          "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition",
                          member.autopilot_enabled
                            ? "border-electric bg-electric-soft text-ink"
                            : "border-line bg-canvas text-muted",
                          disabled && "opacity-60",
                        )}
                      >
                        {member.autopilot_enabled ? "Autopilot on" : "Autopilot off"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted">Only workspace admins can toggle teammate autopilot.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  function choose(r: Role) {
    if (r === role) return;
    actions.setCurrentRole(r);
    toast({ title: `Previewing ${ROLE_LABEL[r]}`, description: ROLE_DESCRIPTION[r], variant: "info" });
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {ROLES.map((r) => {
            const active = r === role;
            return (
              <button
                key={r}
                type="button"
                onClick={() => choose(r)}
                aria-pressed={active}
                className={cn(
                  "rounded-2xl border p-4 text-left transition",
                  active ? "border-electric bg-electric-soft" : "border-line bg-surface hover:border-ink/25",
                )}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-bold text-ink">
                    {ICON[r]}
                    {ROLE_LABEL[r]}
                  </span>
                  {active && (
                    <Badge tone="electric" size="sm">
                      <Check className="h-3 w-3" /> current
                    </Badge>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-muted">{ROLE_DESCRIPTION[r]}</p>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Demo role preview only. It lets you inspect the interface as an admin, member, or viewer and does not change any live user account.
        </p>
      </CardContent>
    </Card>
  );
}
