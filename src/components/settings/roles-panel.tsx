"use client";

import * as React from "react";
import { Card, CardContent, Badge, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useActions, useRole } from "@/lib/store";
import { ROLES, type Role } from "@/lib/types";
import { ROLE_DESCRIPTION, ROLE_LABEL, can } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import { ShieldCheck, UserCog, Eye, Check } from "lucide-react";

const ICON: Record<Role, React.ReactNode> = {
  admin: <ShieldCheck className="h-4 w-4" />,
  member: <UserCog className="h-4 w-4" />,
  viewer: <Eye className="h-4 w-4" />,
};

export function RolesPanel() {
  const role = useRole();
  const actions = useActions();
  const { toast } = useToast();
  const isAdmin = can(role, "manage_roles");
  // In demo (no auth) the switcher is a free preview; in live only admins set roles.
  const canSwitch = !supabaseEnabled || isAdmin;

  function choose(r: Role) {
    if (r === role) return;
    if (!canSwitch) {
      toast({ title: "Admins only", description: "Only an admin can change access levels.", variant: "warning" });
      return;
    }
    actions.setCurrentRole(r);
    toast({ title: `Now acting as ${ROLE_LABEL[r]}`, description: ROLE_DESCRIPTION[r], variant: "info" });
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
                  !canSwitch && !active && "opacity-70",
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
          In live (Supabase) mode, an admin assigns teammate roles on their profile; this control sets
          the active operator level. Members operate the pipeline; viewers are read-only; only admins
          manage settings, API keys, roles, and the agent fleet.
        </p>
      </CardContent>
    </Card>
  );
}
