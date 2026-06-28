"use client";

import * as React from "react";
import { Badge, Card, CardContent, Switch } from "@/components/ui";
import { useActions, useRole, useTools } from "@/lib/store";
import type { ToolId } from "@/lib/types";
import { can } from "@/lib/rbac";

export function ToolsPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_tools");
  const tools = useTools();
  const actions = useActions();

  const enabledCount = tools.filter((t) => t.enabled).length;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone="success" size="sm" dot>
            {enabledCount} enabled
          </Badge>
          {enabledCount < tools.length && (
            <Badge tone="neutral" size="sm" dot>
              {tools.length - enabledCount} disabled
            </Badge>
          )}
          <span className="text-xs text-muted">of {tools.length} tools · toggles apply workspace-wide by default</span>
        </div>

        <div className="divide-y divide-line rounded-2xl border border-line">
          {tools.map((tool) => (
            <div key={tool.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{tool.label}</p>
                <p className="mt-0.5 text-xs text-muted">{tool.description}</p>
              </div>
              <Switch
                id={`tool-${tool.id}`}
                checked={tool.enabled}
                onCheckedChange={() => isAdmin && actions.toggleTool(tool.id as ToolId)}
                label={tool.enabled ? "Enabled" : "Disabled"}
                disabled={!isAdmin}
              />
            </div>
          ))}
        </div>

        {!isAdmin && (
          <p className="text-xs text-muted">
            Admins only. Contact your workspace admin to enable or disable tools.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
