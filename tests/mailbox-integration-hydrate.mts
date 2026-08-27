import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mailboxIntegrationPatchesFromConnections } from "../src/lib/integrations.ts";

describe("mailboxIntegrationPatchesFromConnections", () => {
  it("marks Outlook/Teams not_configured when no Graph mailbox is connected", () => {
    const patches = mailboxIntegrationPatchesFromConnections({ connections: [], seats: [] });
    const outlook = patches.find((p) => p.id === "int_outlook");
    const teams = patches.find((p) => p.id === "int_graph_teams");
    assert.equal(outlook?.patch.status, "not_configured");
    assert.equal(teams?.patch.status, "not_configured");
    assert.equal(teams?.patch.mode, "mock");
  });

  it("connects Outlook when Graph mailbox exists; Teams stays degraded without live seat", () => {
    const patches = mailboxIntegrationPatchesFromConnections({
      connections: [
        {
          provider: "Microsoft Graph",
          accountEmail: "talent@mantu.com",
          hasRefreshToken: true,
        },
      ],
      seats: [
        {
          provider: "Microsoft Graph",
          mode: "mock",
          status: "active",
          connectedAccount: "talent@mantu.com",
        },
      ],
    });
    const outlook = patches.find((p) => p.id === "int_outlook");
    const teams = patches.find((p) => p.id === "int_graph_teams");
    assert.equal(outlook?.patch.status, "connected");
    assert.equal(outlook?.patch.connectedAccount, "talent@mantu.com");
    assert.equal(teams?.patch.status, "degraded");
    assert.equal(teams?.patch.mode, "mock");
  });

  it("marks Teams connected only with a live Graph seat", () => {
    const patches = mailboxIntegrationPatchesFromConnections({
      connections: [
        {
          provider: "Microsoft Graph",
          accountEmail: "talent@mantu.com",
          hasRefreshToken: true,
        },
      ],
      seats: [
        {
          provider: "Microsoft Graph",
          mode: "live",
          status: "active",
          connectedAccount: "talent@mantu.com",
        },
      ],
    });
    const teams = patches.find((p) => p.id === "int_graph_teams");
    assert.equal(teams?.patch.status, "connected");
    assert.equal(teams?.patch.mode, "live");
  });
});
