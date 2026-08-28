/**
 * Unit tests for international hiring geography resolution + aggregation.
 */
import assert from "node:assert/strict";
import { resolveCountryFromLocation, isRemoteOrUnspecifiedLocation } from "../src/lib/geo/resolve-country.ts";
import { deriveHiringGeography } from "../src/lib/hiring-geography.ts";
import type { Candidate } from "../src/lib/types.ts";

assert.equal(resolveCountryFromLocation("Milan, IT")?.iso2, "IT");
assert.equal(resolveCountryFromLocation("Paris, FR")?.numericId, "250");
assert.equal(resolveCountryFromLocation("Austin, US")?.iso2, "US");
assert.equal(resolveCountryFromLocation("Lagos, NG")?.name.includes("Nigeria"), true);
assert.equal(resolveCountryFromLocation("Remote / EU"), null);
assert.equal(isRemoteOrUnspecifiedLocation("Remote / EU"), true);
assert.equal(resolveCountryFromLocation("Berlin")?.iso2, "DE");

function stub(partial: Partial<Candidate> & Pick<Candidate, "id" | "location">): Candidate {
  return {
    campaignId: "c1",
    name: "Test",
    email: "",
    avatarInitials: "T",
    currentTitle: "Eng",
    currentCompany: "Co",
    timezone: "",
    linkedinUrl: "",
    githubUrl: "",
    sourcePlatform: "Manual",
    sourceQuery: "",
    matchScore: 80,
    matchBreakdown: [],
    techStack: [],
    yearsExperience: 5,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "",
    stage: "New",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  } as Candidate;
}

const geo = deriveHiringGeography(
  [
    stub({ id: "1", location: "Milan, IT", matchScore: 90 }),
    stub({ id: "2", location: "Rome, IT", matchScore: 80, stage: "Sourced" }),
    stub({ id: "3", location: "Paris, FR", matchScore: 85, stage: "Contacted" }),
    stub({ id: "4", location: "Remote / EU", matchScore: 70 }),
    stub({
      id: "5",
      location: "Austin, US",
      matchScore: 60,
      stage: "Booked",
      booking: {
        id: "b1",
        candidateId: "5",
        candidateName: "Test",
        campaignId: "c1",
        role: "Eng",
        interviewer: "I",
        interviewerEmail: "i@example.com",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        timezone: "America/Chicago",
        status: "Confirmed",
        calLink: "https://outlook.office.com/calendar/item/x",
        teamsLink: "https://teams.microsoft.com/l/meetup-join/x",
        agenda: [],
        createdAt: new Date().toISOString(),
      },
    }),
    stub({
      id: "6",
      location: "Seattle, US",
      matchScore: 55,
      stage: "Booked",
      booking: {
        id: "b2",
        candidateId: "6",
        candidateName: "NoLink",
        campaignId: "c1",
        role: "Eng",
        interviewer: "I",
        interviewerEmail: "i@example.com",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        timezone: "America/Los_Angeles",
        status: "Proposed",
        calLink: "",
        teamsLink: "",
        agenda: [],
        createdAt: new Date().toISOString(),
      },
    }),
  ],
  [
    // Stage Contacted alone is not enough — need a real send fact.
    { candidateId: "3", dryRun: false, sentAt: new Date().toISOString() },
  ],
);

assert.equal(geo.countriesRepresented, 3);
assert.equal(geo.remoteOrUnspecified, 1);
assert.equal(geo.countByNumericId["380"], 2); // Italy
assert.equal(geo.byCountry[0]?.iso2, "IT");
assert.equal(geo.byCountry.find((r) => r.iso2 === "FR")?.contacted, 1);
assert.equal(geo.byCountry.find((r) => r.iso2 === "IT")?.contacted, 0); // Sourced ≠ contacted
assert.equal(geo.byCountry.find((r) => r.iso2 === "US")?.booked, 1); // URL required

{
  const stageOnly = deriveHiringGeography([
    stub({ id: "3", location: "Paris, FR", matchScore: 85, stage: "Contacted" }),
  ]);
  assert.equal(
    stageOnly.byCountry.find((r) => r.iso2 === "FR")?.contacted,
    0,
    "Contacted stage without isRealSendFact must not count",
  );
}

console.log("hiring-geography: ok");
