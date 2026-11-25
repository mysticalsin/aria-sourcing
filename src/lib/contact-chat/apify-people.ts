/**
 * Apify people-search connector.
 * The only actor is a synthetic people search. LinkedIn scrapers, Voyager,
 * cookies, and live Apify hosts are refused. The default transport is fake.
 */

export const PEOPLE_SEARCH_ACTOR = "aria/people-search";
export const PEOPLE_SEARCH_CAP = 8;

export interface Person {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  synthetic: true;
}

export const SYNTHETIC_PEOPLE: Person[] = [
  { id: "ada-north", name: "Ada North", title: "Product Designer", company: "Northwind Demo", location: "Lisbon", synthetic: true },
  { id: "kai-west", name: "Kai West", title: "Backend Engineer", company: "Example Labs", location: "Porto", synthetic: true },
  { id: "noor-hale", name: "Noor Hale", title: "Recruiter", company: "Sample and Co", location: "Lyon", synthetic: true },
  { id: "remy-cole", name: "Remy Cole", title: "Data Analyst", company: "Fixture Works", location: "Berlin", synthetic: true },
  { id: "sable-quinn", name: "Sable Quinn", title: "Engineering Manager", company: "Demo Forge", location: "Dublin", synthetic: true },
  { id: "ivo-marsh", name: "Ivo Marsh", title: "Security Engineer", company: "Placeholder Inc", location: "Amsterdam", synthetic: true },
  { id: "lina-voss", name: "Lina Voss", title: "Product Manager", company: "Mock North", location: "Stockholm", synthetic: true },
  { id: "theo-park", name: "Theo Park", title: "Frontend Engineer", company: "Synthetic Systems", location: "Madrid", synthetic: true },
  { id: "mina-cho", name: "Mina Cho", title: "Researcher", company: "Example Studio", location: "Seoul", synthetic: true },
  { id: "omar-ellis", name: "Omar Ellis", title: "Solutions Architect", company: "Northwind Demo", location: "Austin", synthetic: true },
  { id: "priya-shah", name: "Priya Shah", title: "Designer", company: "Fixture Works", location: "London", synthetic: true },
  { id: "jules-berg", name: "Jules Berg", title: "Support Lead", company: "Sample and Co", location: "Oslo", synthetic: true },
];

const BLOCKED_ACTOR = /linkedin|voyager|cookie|scraper|phantom|login|browser/i;
const PERSON_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isAllowedPeopleSearchActor(actorId: string): boolean {
  return actorId === PEOPLE_SEARCH_ACTOR && !BLOCKED_ACTOR.test(actorId);
}

export interface ApifyPeopleQuery {
  query: string;
  limit: number;
}

export interface ApifyPeopleTransport {
  run(actorId: string, input: ApifyPeopleQuery): Promise<Person[]>;
}

export function createFakeApifyTransport(catalog: Person[] = SYNTHETIC_PEOPLE): {
  calls: { actorId: string; limit: number }[];
  transport: ApifyPeopleTransport;
} {
  const calls: { actorId: string; limit: number }[] = [];
  const transport: ApifyPeopleTransport = {
    async run(actorId, input) {
      if (!isAllowedPeopleSearchActor(actorId)) {
        throw new Error("People search refuses this connector.");
      }
      calls.push({ actorId, limit: input.limit });
      return catalog.map((person) => ({ ...person, synthetic: true as const }));
    },
  };
  return { calls, transport };
}

const demo = createFakeApifyTransport();

function asPerson(row: Person): Person | null {
  if (!row || typeof row.id !== "string" || !PERSON_ID.test(row.id)) return null;
  if (!row.name || !row.title || !row.company) return null;
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    company: row.company,
    location: row.location ?? "",
    synthetic: true,
  };
}

export type PeopleSearchResult =
  | { ok: true; people: Person[]; cap: number }
  | { ok: false; reason: "connector"; people: Person[]; cap: number };

export async function searchPeople(
  query: string,
  options?: { transport?: ApifyPeopleTransport; actorId?: string },
): Promise<PeopleSearchResult> {
  const actorId = options?.actorId ?? PEOPLE_SEARCH_ACTOR;
  const cap = PEOPLE_SEARCH_CAP;
  if (!isAllowedPeopleSearchActor(actorId)) {
    return { ok: false, reason: "connector", people: [], cap };
  }
  const transport = options?.transport ?? demo.transport;
  const rows = await transport.run(actorId, { query, limit: cap });
  const needle = query.trim().toLocaleLowerCase();
  const matched = rows
    .map(asPerson)
    .filter((person): person is Person => person !== null)
    .filter((person) => {
      if (!needle) return true;
      const haystack = `${person.name} ${person.title} ${person.company}`.toLocaleLowerCase();
      return haystack.includes(needle);
    });
  return { ok: true, people: matched.slice(0, cap), cap };
}
