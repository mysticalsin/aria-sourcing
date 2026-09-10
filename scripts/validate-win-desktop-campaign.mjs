import fs from "node:fs";
import { projectSourcingAgentWorkspace } from "../src/lib/sourcing/sourcing-agent-contract";
import { defaultSettings } from "../src/lib/seed";

const campaign = JSON.parse(fs.readFileSync("/tmp/win-desktop-campaign.json", "utf8"));
const settings = defaultSettings();
const projected = projectSourcingAgentWorkspace(
  {
    campaigns: [campaign],
    candidates: [],
    settings: {
      llmProviders: settings.llmProviders,
      savedModels: settings.savedModels,
      defaultModels: settings.defaultModels,
    },
  },
  campaign.id,
);
console.log(JSON.stringify({ status: projected.status }, null, 2));
if (projected.status !== "ok") process.exit(1);
