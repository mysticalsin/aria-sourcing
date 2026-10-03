import fs from "node:fs";
import { createCampaign, parseEmailAndJD } from "../src/lib/mock-ai";
import { evaluateNeedReadiness } from "../src/lib/needs/readiness";

const email = `From: Maryem Jendoubi <maryem@amacan.com>
Subject: Urgent — Enterprise Windows Desktop Engineer (MOR1JP00097605) Montreal / Morgan Stanley

Type: Consulting
Category: Active
Priority: Urgent and Critical
Reason: Opening Position
Company Employed by: AMACAN
City: Montreal
Client: Morgan Stanley
Company Billing To: AMACAN
Status: Running
Title: MOR1JP00097605 - Enterprise Windows Desktop Engineer
Contract Type: Undetermined Duration Contract (CDI)
Start Date: 06/09/2026
Number of people: 1
Remote: Possible partially remote
Client Sector: Bank & Finance
Project Type: Expertise
Project Duration: 12 Month

Profiles: IS&D - Support Engineer
Skill (Must): Windows, PowerShell, Microsoft Intune, Cloud Migration
Skill (Nice to have): ServiceNow, Jira, Agile Methodology
Language (Must): English - Fluent
Level of Experience: Senior - From 7 to 10 years

Mission:
40 hrs / week
Job Title: Enterprise Windows Desktop Engineer
Experience Level: Level 4 (advanced): 7-15 years
Location: Montreal (in office presence 3x/week)

The End User Endpoint and Tooling Team delivers an enterprise class Windows Desktop Platform.
Required: Windows 10/11/Server 2019, Windows 11 Intune Modern Management, OSD orchestration,
PowerShell, cloud migration to OneDrive, Active Directory, Group Policy, DNS/NRPT, PKI/CA,
RADIUS, NPS, troubleshooting, automation, enterprise hardware management.
Desired: Autopilot, Windows365, Jira, ServiceNow, Agile.

Perm: 116k max
Freelance: 87$/h
`;

const parsed = parseEmailAndJD({ email });
const ja = parsed.jobAnalysis;
ja.title = "Enterprise Windows Desktop Engineer";
ja.seniority = "Senior";
ja.employmentType = "Full-time";
ja.locationType = "Hybrid";
ja.location = "Montreal";
ja.regions = ["Montreal", "Canada"];
ja.requiredSkills = [
  "Windows",
  "PowerShell",
  "Microsoft Intune",
  "Cloud Migration",
  "Active Directory",
  "Group Policy",
];
ja.niceToHaveSkills = [
  "ServiceNow",
  "Jira",
  "Agile Methodology",
  "Autopilot",
  "Windows365",
  "OneDrive",
];
ja.minYearsExperience = 7;
ja.maxYearsExperience = 10;
ja.industryExperience = ["Bank & Finance"];
ja.urgency = "Urgent";
ja.currency = "CAD";
ja.salaryMin = null;
ja.salaryMax = 116_000;
ja.department = "IS&D - Support Engineer";
ja.reportingTo = "SOUSA ALVES Sara";
ja.teamSize = "1";
ja.education = "";
ja.timezone = "America/Montreal";
ja.language = "en";
ja.expectedStartDate = "2026-09-06";
ja.companyStageTarget = ["Enterprise"];
ja.equity = false;
ja.validationWarnings = [];

const readiness = evaluateNeedReadiness(ja);
if (!readiness.ready) {
  console.error("need not ready", readiness.issues);
  process.exit(1);
}

const campaign = createCampaign(ja, {
  hiringManager: "SOUSA ALVES Sara",
  hiringManagerEmail: "",
});
campaign.id = "camp_mor1jp00097605_enterprise-windows-desktop-engineer";
campaign.status = "Sourcing";
campaign.title = "Enterprise Windows Desktop Engineer";
campaign.urgency = "Urgent";
campaign.sourcingStrategy.primaryPlatforms = ["LinkedIn", "Talent Pool"];
campaign.sourcingStrategy.linkedinBoolean =
  '("Enterprise Windows Desktop Engineer" OR "Windows Desktop Engineer" OR "Endpoint Engineer" OR "Intune Engineer" OR "Windows Engineer") AND (Intune OR PowerShell OR "Active Directory" OR Autopilot) AND (Montreal OR Canada) AND NOT recruiter';
campaign.sourcingStrategy.githubQueries = [
  {
    label: "PowerShell Windows",
    query: "PowerShell Windows Intune followers:>20 repos:>5",
    estimatedResults: 120,
  },
  {
    label: "Intune automation",
    query: "Intune PowerShell language:PowerShell followers:>10",
    estimatedResults: 80,
  },
  {
    label: "Windows endpoint",
    query: "Windows Autopilot OR Intune language:PowerShell",
    estimatedResults: 60,
  },
];
campaign.hiringManager = "SOUSA ALVES Sara";
campaign.department = "IS&D - Support Engineer";
campaign.activities = [
  {
    id: "act_need_seed_mor1jp00097605",
    type: "campaign",
    title: "Need seeded from AMACAN / Morgan Stanley brief",
    detail:
      "MOR1JP00097605 · AMACAN · Morgan Stanley · Montreal hybrid · CDI · Perm 116k max / Freelance 87$/h · Managers: SOUSA ALVES Sara, MARGIOTTA Lisa · Recruiter: JENDOUBI Maryem",
    at: new Date().toISOString(),
  },
];

fs.writeFileSync("/tmp/win-desktop-campaign.json", JSON.stringify(campaign));
console.log(
  JSON.stringify(
    {
      id: campaign.id,
      status: campaign.status,
      title: campaign.title,
      ready: readiness.ready,
      skills: campaign.jobAnalysis.requiredSkills,
      platforms: campaign.sourcingStrategy.primaryPlatforms,
    },
    null,
    2,
  ),
);
