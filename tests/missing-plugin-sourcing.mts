import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

const {
  MISSING_PLUGIN_CODE,
  MISSING_PLUGIN_MESSAGE,
  LINKEDIN_PROFILE_SEARCH_SETTINGS_HREF,
  isLinkedInFirstPlatform,
  missingPluginPayload,
} = await import("../src/lib/sourcing/missing-plugin.ts");
const { providersForCampaign, availableProviders } = await import(
  "../src/lib/sourcing/providers/index.ts"
);
const { linkedinProfilesProvider } = await import(
  "../src/lib/sourcing/providers/linkedin-profiles.ts"
);
const { githubProvider } = await import("../src/lib/sourcing/providers/github.ts");
const { linkedinWebProvider } = await import("../src/lib/sourcing/providers/web.ts");
const { buildSeedState } = await import("../src/lib/seed.ts");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

{
  ok("MISSING_PLUGIN code is stable", MISSING_PLUGIN_CODE === "MISSING_PLUGIN");
  ok(
    "MISSING_PLUGIN message tells operators to connect LinkedIn/Apify and that GitHub Live cannot fill",
    /Connect LinkedIn and Apify in Settings/i.test(MISSING_PLUGIN_MESSAGE) &&
      /GitHub Sourcing cannot fill this role/i.test(MISSING_PLUGIN_MESSAGE),
  );
  ok(
    "settings deep-link targets Access & Keys API panel",
    LINKEDIN_PROFILE_SEARCH_SETTINGS_HREF === "/settings?tab=access#api-keys-panel",
  );
  const payload = missingPluginPayload();
  ok("payload includes code + settingsHref", payload.code === "MISSING_PLUGIN" && !!payload.settingsHref);
}

{
  ok("LinkedIn is LinkedIn-first", isLinkedInFirstPlatform("LinkedIn"));
  ok("Talent Pool is LinkedIn-first", isLinkedInFirstPlatform("Talent Pool"));
  ok("Referral is LinkedIn-first", isLinkedInFirstPlatform("Referral"));
  ok("GitHub is not LinkedIn-first", !isLinkedInFirstPlatform("GitHub"));
}

{
  const s = buildSeedState();
  const campaign = s.campaigns[0]!;
  const ctx = {
    campaign: {
      ...campaign,
      sourcingStrategy: {
        ...campaign.sourcingStrategy,
        primaryPlatforms: ["LinkedIn" as const],
      },
    },
    existing: [],
    weights: campaign.scoringWeights,
    githubToken: "",
    linkedInProfileToken: null,
  };
  const available = await availableProviders(ctx);
  ok(
    "without Apify token, linkedin_profiles is unavailable",
    !available.some((p) => p.id === "linkedin_profiles"),
  );
  ok("without Apify token, github + linkedin_web remain available", available.some((p) => p.id === "github") && available.some((p) => p.id === "linkedin_web"));

  const withToken = await availableProviders({
    ...ctx,
    linkedInProfileToken: "apify_api_TEST_PLACEHOLDER_0000000000",
  });
  ok(
    "with Apify token, linkedin_profiles becomes available",
    withToken.some((p) => p.id === "linkedin_profiles"),
  );

  const selected = providersForCampaign(withToken, ["LinkedIn"]);
  ok(
    "LinkedIn-first campaign prefers profile search before web/GitHub",
    selected[0]?.id === "linkedin_profiles",
  );
  ok("linkedin_profiles displayPlatform is LinkedIn not Apify", linkedinProfilesProvider.displayPlatform === "LinkedIn");
  ok("github displayPlatform is GitHub", githubProvider.displayPlatform === "GitHub");
  ok("linkedin_web displayPlatform is LinkedIn", linkedinWebProvider.displayPlatform === "LinkedIn");
}

{
  // Provider source must use Full + email for quality/contactability — Short
  // yields empty headline/skills and fails the 80% floor.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/lib/sourcing/providers/linkedin-profiles.ts", import.meta.url), "utf8"),
  );
  ok(
    "linkedin_profiles harvest uses Full + email search (not Short)",
    /profileScraperMode:\s*"Full \+ email search"/.test(src) && !/profileScraperMode:\s*"Short"/.test(src),
  );
  ok("linkedin_profiles budget allows Full harvest", /DEFAULT_BUDGET_MS\s*=\s*150_000/.test(src));
}

console.log(`RESULT missing-plugin-sourcing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
