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

const geo = deriveHiringGeography([
  stub({ id: "1", location: "Milan, IT", matchScore: 90 }),
  stub({ id: "2", location: "Rome, IT", matchScore: 80 }),
  stub({ id: "3", location: "Paris, FR", matchScore: 85 }),
  stub({ id: "4", location: "Remote / EU", matchScore: 70 }),
  stub({ id: "5", location: "Austin, US", matchScore: 60, stage: "Booked" }),
]);

assert.equal(geo.countriesRepresented, 3);
assert.equal(geo.remoteOrUnspecified, 1);
assert.equal(geo.countByNumericId["380"], 2); // Italy
assert.equal(geo.byCountry[0]?.iso2, "IT");
assert.equal(geo.byCountry.find((r) => r.iso2 === "US")?.booked, 1);

console.log("hiring-geography: ok");
