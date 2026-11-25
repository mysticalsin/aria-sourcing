import { readFileSync } from "fs";
import { accountPrompt, LINKEDIN_ACCOUNT_SETTINGS_PATH } from "../src/lib/contact-chat/account-view";
import {
  isAllowedPeopleSearchActor,
  PEOPLE_SEARCH_ACTOR,
  PEOPLE_SEARCH_CAP,
  searchPeople,
  SYNTHETIC_PEOPLE,
  createFakeApifyTransport,
} from "../src/lib/contact-chat/apify-people";
import { createFakeHeyReachMcp } from "../src/lib/contact-chat/heyreach-mcp";
import {
  linkedInAccountView,
  putLinkedInAccountToken,
  resetContactChatMemory,
  setHeyReachEnabled,
  storedTokenEquals,
  approveExactText,
  openThread,
} from "../src/lib/contact-chat/memory";
import { sendContactMessage } from "../src/lib/contact-chat/send";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const SECRET = "synthetic-heyreach-token";

/* Channel off refuses the send and does not touch the fake MCP. */
{
  resetContactChatMemory();
  const mcp = createFakeHeyReachMcp();
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("live fetch");
  }) as typeof fetch;
  const result = await sendContactMessage({ personId: "ada-north", text: "Hello Ada" }, mcp.transport);
  ok("channel off refuses send", result.ok === false && result.reason === "channel-off");
  ok("channel off names HeyReach", result.ok === false && /HeyReach is off/.test(result.message));
  ok("channel off includes the settings path", result.ok === false && result.settingsPath === LINKEDIN_ACCOUNT_SETTINGS_PATH);
  ok("channel off does not call HeyReach MCP", mcp.calls.length === 0);
  ok("channel off does not call fetch", fetched === false);
  restoreFetch();
}

/* Missing token shows the settings path and the add-your-account state. */
{
  resetContactChatMemory();
  const view = linkedInAccountView();
  const prompt = accountPrompt(view);
  ok("missing token keeps the channel off", view.enabled === false);
  ok("missing token is not configured", view.tokenConfigured === false && view.addAccount === true);
  ok("missing token view has no token field", !("token" in view));
  ok("missing token prompt asks to add your account", prompt !== null && /add your account/i.test(prompt.message));
  ok("missing token prompt links to settings", prompt?.settingsPath === "/settings#linkedin-account");
  const enabled = setHeyReachEnabled(true);
  ok("enable without a token is refused", enabled.ok === false && enabled.reason === "missing-token");
  ok("enable without a token shows the settings path", enabled.ok === false && enabled.settingsPath === LINKEDIN_ACCOUNT_SETTINGS_PATH);
  putLinkedInAccountToken(SECRET);
  const saved = linkedInAccountView();
  ok("saved account still starts off", saved.enabled === false && saved.tokenConfigured === true && saved.addAccount === false);
  ok("saved account view does not contain the token", !JSON.stringify(saved).includes(SECRET));
  const cookie = putLinkedInAccountToken("li_at=synthetic-session");
  ok("session cookie is refused", cookie.ok === false && cookie.reason === "session-cookie");
  ok("refused cookie does not replace the saved token", storedTokenEquals(SECRET));
  ok("account view does not echo a session cookie", !JSON.stringify(cookie).includes("li_at"));
  restoreFetch();
}

/* An approved chat send hits the fake HeyReach MCP once. */
{
  resetContactChatMemory();
  putLinkedInAccountToken(SECRET);
  const turnedOn = setHeyReachEnabled(true);
  ok("channel turns on after a token is saved", turnedOn.ok === true && turnedOn.account.enabled === true);
  const mcp = createFakeHeyReachMcp();
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("live fetch");
  }) as typeof fetch;
  const unapproved = await sendContactMessage({ personId: "ada-north", text: "Hello Ada" }, mcp.transport);
  ok("send without exact-text approval is refused", unapproved.ok === false && unapproved.reason === "approval");
  ok("unapproved send does not call HeyReach MCP", mcp.calls.length === 0);
  approveExactText("ada-north", "Hello Ada");
  const sent = await sendContactMessage({ personId: "ada-north", text: "Hello Ada" }, mcp.transport);
  ok("approved send succeeds", sent.ok === true);
  ok("approved send hits the fake HeyReach MCP once", mcp.calls.length === 1 && mcp.calls[0].tool === "send_message");
  ok("approved send uses the exact text", mcp.calls[0]?.text === "Hello Ada" && mcp.calls[0]?.personId === "ada-north");
  ok("approved send does not hand the token to the MCP log", mcp.calls[0]?.tokenPresent === true && !JSON.stringify(mcp.calls).includes(SECRET));
  ok("approved send does not call fetch", fetched === false);
  const thread = openThread("ada-north");
  const other = openThread("kai-west");
  ok("one thread per person", thread.id === "thread_ada-north" && other.id === "thread_kai-west" && thread.id !== other.id);
  ok("sent text is on that person's thread", thread.messages.length === 1 && thread.messages[0].text === "Hello Ada");
  const again = await sendContactMessage({ personId: "ada-north", text: "Hello Ada" }, mcp.transport);
  ok("a second send needs a new exact-text approval", again.ok === false && again.reason === "approval");
  ok("second send does not call HeyReach MCP again", mcp.calls.length === 1);
  approveExactText("ada-north", "Hello Ada");
  const edited = await sendContactMessage({ personId: "ada-north", text: "Hello Ada!" }, mcp.transport);
  ok("edited text is not covered by the approval", edited.ok === false && edited.reason === "approval" && mcp.calls.length === 1);
  restoreFetch();
}

/* Apify search returns capped synthetic people and never calls LinkedIn. */
{
  resetContactChatMemory();
  const apify = createFakeApifyTransport();
  const hosts: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    hosts.push(String(url));
    throw new Error("live fetch");
  }) as typeof fetch;
  const result = await searchPeople("engineer", { transport: apify.transport });
  ok("people search succeeds", result.ok === true);
  ok("people search stays inside the cap", result.people.length > 0 && result.people.length <= PEOPLE_SEARCH_CAP);
  ok("catalog is larger than the cap", SYNTHETIC_PEOPLE.length > PEOPLE_SEARCH_CAP);
  ok("people search results are synthetic", result.people.every((person) => person.synthetic === true));
  ok("people search hits the fake Apify actor once", apify.calls.length === 1 && apify.calls[0].actorId === PEOPLE_SEARCH_ACTOR);
  ok("people search actor is not a LinkedIn scraper", !/linkedin|voyager|cookie|scraper/i.test(apify.calls[0].actorId));
  ok("people search does not call fetch", hosts.length === 0);
  const blocked = createFakeApifyTransport();
  const refused = await searchPeople("engineer", { transport: blocked.transport, actorId: "apify/linkedin-profile-scraper" });
  ok("LinkedIn scraper actor is refused", refused.ok === false && refused.people.length === 0);
  ok("refused scraper is not called", blocked.calls.length === 0);
  ok("blocklist rejects the scraper id", isAllowedPeopleSearchActor("apify/linkedin-profile-scraper") === false);
  ok("empty search is still capped", (await searchPeople("", { transport: apify.transport })).people.length === PEOPLE_SEARCH_CAP);
  const source = readFileSync(new URL("../src/lib/contact-chat/apify-people.ts", import.meta.url), "utf8");
  const heyreach = readFileSync(new URL("../src/lib/contact-chat/heyreach-mcp.ts", import.meta.url), "utf8");
  ok("people search source has no live Apify or LinkedIn host", !/api\.apify\.com|linkedin\.com|voyager\/api/.test(source));
  ok("people search source does not call fetch", !/\bfetch\(/.test(source));
  ok("HeyReach MCP source has no live host and does not call fetch", !/api\.heyreach\.io|\bfetch\(/.test(heyreach));
  restoreFetch();
}

console.log(`RESULT contact-chat: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
