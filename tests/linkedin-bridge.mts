/* ============================================================================
   tests/linkedin-bridge.mts
   Experimental LinkedIn bridge: request builders vs the extension allowlist,
   response parsers (nested and normalized Voyager JSON), planner, pacing,
   pairing tokens, answer classification, and the structural guarantees
   (the bridge is isolated, sends only come from a person, no LinkedIn
   credential is stored or relayed).
   ========================================================================== */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkLinkedInRequest } from "../extensions/linkedin-bridge/allowlist.js";
import { parseCapturedQuery, topLevelKeys } from "../extensions/linkedin-bridge/queries.js";
import { classifyAnswer, graphqlErrors } from "../src/lib/linkedin-bridge/outcome.ts";
import {
  parseConversations,
  parseIdentity,
  parseMessages,
  parseProfileLookup,
  parseSendResult,
} from "../src/lib/linkedin-bridge/parse.ts";
import { planTasks, type PlanInput } from "../src/lib/linkedin-bridge/planner.ts";
import { linkedInBridgeEnabled, readBridgePolicy, sendSlot } from "../src/lib/linkedin-bridge/policy.ts";
import { bridgeTokenFromHeader, generateBridgeToken, hashBridgeToken, randomTrackingId } from "../src/lib/linkedin-bridge/token.ts";
import {
  FALLBACK_QUERIES,
  buildConversationsRequest,
  buildMeRequest,
  buildMessagesRequest,
  buildProfileLookupRequest,
  buildSendMessageRequest,
  isConversationUrn,
  memberIdFromUrn,
  mergeCapturedQueries,
  publicIdFromProfileUrl,
  restliEncode,
} from "../src/lib/linkedin-bridge/voyager.ts";

const SELF = "ACoAAAself1";
const OTHER = "ACoAAAother2";
const CONV1 = `urn:li:msg_conversation:(urn:li:fsd_profile:${SELF},2-YWJjZGVm==)`;
const CONV2 = `urn:li:msg_conversation:(urn:li:fsd_profile:${SELF},2-Z2hpamts==)`;
const PART_SELF = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${SELF}`;
const PART_OTHER = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${OTHER}`;
const msgUrn = (id: string) => `urn:li:msg_message:(urn:li:fsd_profile:${SELF},2-${id})`;

const member = (first: string, last: string, extra: Record<string, unknown> = {}) => ({
  member: { firstName: { text: first }, lastName: { text: last }, ...extra },
});

// ── URNs and URLs ────────────────────────────────────────────────────────────

test("profile URLs resolve to public ids, anything else is refused", () => {
  assert.equal(publicIdFromProfileUrl("https://www.linkedin.com/in/jane-doe/"), "jane-doe");
  assert.equal(publicIdFromProfileUrl("linkedin.com/in/jane-doe"), "jane-doe");
  assert.equal(publicIdFromProfileUrl("https://fr.linkedin.com/in/jos%C3%A9-garc%C3%ADa?trk=x"), "josé-garcía");
  assert.equal(publicIdFromProfileUrl("https://www.linkedin.com/company/amaris/"), null);
  assert.equal(publicIdFromProfileUrl("https://evil.example/in/jane-doe"), null);
  assert.equal(publicIdFromProfileUrl("https://linkedin.com.evil.example/in/jane-doe"), null);
  assert.equal(publicIdFromProfileUrl("https://www.linkedin.com/in/jane-doe/details/experience"), null);
  assert.equal(publicIdFromProfileUrl(""), null);
});

test("URN helpers", () => {
  assert.equal(memberIdFromUrn(PART_OTHER), OTHER);
  assert.equal(memberIdFromUrn(`urn:li:fs_miniProfile:${SELF}`), SELF);
  assert.equal(memberIdFromUrn("urn:li:member:12345"), null);
  assert.equal(isConversationUrn(CONV1), true);
  assert.equal(isConversationUrn("urn:li:msg_conversation:(x),y"), false);
  assert.equal(restliEncode(CONV1), "urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3AACoAAAself1%2C2-YWJjZGVm%3D%3D%29");
});

// ── Request builders vs the extension allowlist ─────────────────────────────

test("every request ARIA builds passes the extension allowlist", () => {
  const captured = {
    messengerConversations: [{ queryId: `messengerConversations.${"a".repeat(32)}`, variables: ["mailboxUrn"] }],
    messengerMessages: [{ queryId: `messengerMessages.${"b".repeat(32)}`, variables: ["conversationUrn"] }],
  };
  const requests = [
    buildMeRequest(),
    buildConversationsRequest(SELF),
    buildConversationsRequest(SELF, captured),
    buildMessagesRequest(CONV1),
    buildMessagesRequest(CONV1, captured),
    buildProfileLookupRequest("josé-garcía"),
    buildSendMessageRequest({ selfMemberId: SELF, text: "Hi", conversationUrn: CONV1, originToken: "t", trackingId: "x" }),
    buildSendMessageRequest({ selfMemberId: SELF, text: "Hi", recipientMemberId: OTHER, originToken: "t", trackingId: "x" }),
  ];
  for (const request of requests) assert.equal(checkLinkedInRequest(request), null, request.path);
});

test("captured query ids win over the fallbacks, unknown templates are ignored", () => {
  const live = `messengerConversations.${"c".repeat(32)}`;
  assert.match(buildConversationsRequest(SELF, { messengerConversations: [{ queryId: live, variables: ["mailboxUrn"] }] }).path, new RegExp(live));
  // A template with variables ARIA cannot fill falls back.
  const odd = buildConversationsRequest(SELF, {
    messengerConversations: [{ queryId: live, variables: ["mailboxUrn", "syncToken"] }],
  });
  assert.match(odd.path, new RegExp(FALLBACK_QUERIES.conversations.queryId));
  const messages = buildMessagesRequest(CONV1, null, 1730000000000);
  assert.match(messages.path, /deliveredAt:1730000000000/);
  assert.match(messages.path, /countBefore:40/);
  assert.ok(messages.path.includes(`conversationUrn:${restliEncode(CONV1)}`));
  const bare = buildMessagesRequest(CONV1, {
    messengerMessages: [{ queryId: `messengerMessages.${"d".repeat(32)}`, variables: ["conversationUrn"] }],
  });
  assert.match(bare.path, /variables=\(conversationUrn:[^,]+\)$/);
});

test("send payload: reply or new chat, exactly one target", () => {
  const reply = JSON.parse(
    buildSendMessageRequest({ selfMemberId: SELF, text: "Bonjour", conversationUrn: CONV1, originToken: "o", trackingId: "t" }).body!,
  );
  assert.equal(reply.message.conversationUrn, CONV1);
  assert.equal(reply.message.body.text, "Bonjour");
  assert.equal(reply.mailboxUrn, `urn:li:fsd_profile:${SELF}`);
  assert.equal(reply.hostRecipientUrns, undefined);
  assert.equal(reply.dedupeByClientGeneratedToken, false);
  const fresh = JSON.parse(
    buildSendMessageRequest({ selfMemberId: SELF, text: "Hi", recipientMemberId: OTHER, originToken: "o", trackingId: "t" }).body!,
  );
  assert.deepEqual(fresh.hostRecipientUrns, [`urn:li:fsd_profile:${OTHER}`]);
  assert.equal(fresh.message.conversationUrn, undefined);
  assert.throws(() => buildSendMessageRequest({ selfMemberId: SELF, text: "x", originToken: "o", trackingId: "t" }));
  assert.throws(() =>
    buildSendMessageRequest({ selfMemberId: SELF, text: "x", conversationUrn: CONV1, recipientMemberId: OTHER, originToken: "o", trackingId: "t" }),
  );
  assert.throws(() => buildSendMessageRequest({ selfMemberId: SELF, text: "  ", conversationUrn: CONV1, originToken: "o", trackingId: "t" }));
});

test("the allowlist refuses everything else", () => {
  const graphql = (query: string) => `/voyager/api/voyagerMessagingGraphQL/graphql?${query}`;
  const refused = [
    { method: "GET", path: "/voyager/api/identity/profiles/jane/profileView", headers: {} },
    { method: "GET", path: "/voyager/api/me?x=1", headers: {} },
    { method: "POST", path: "/voyager/api/me", headers: {}, body: "{}" },
    { method: "GET", path: graphql(`queryId=voyagerSearchDashClusters.${"a".repeat(32)}&variables=(x:1)`), headers: {} },
    { method: "POST", path: graphql(`queryId=messengerConversations.${"a".repeat(32)}&variables=(x:1)`), headers: {}, body: "{}" },
    { method: "POST", path: "/voyager/api/voyagerMessagingDashMessengerMessages?action=deleteMessage", headers: {}, body: "{}" },
    { method: "POST", path: "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage", headers: {} },
    { method: "GET", path: "/voyager/api/me", headers: { cookie: "li_at=x" } },
    { method: "GET", path: "/voyager/api/me", headers: {}, body: "x" },
    { method: "GET", path: "//evil.example/voyager/api/me", headers: {} },
    { method: "GET", path: "https://evil.example/voyager/api/me", headers: {} },
    { method: "GET", path: "/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=a&decorationId=x", headers: {} },
    null,
  ];
  for (const request of refused) assert.notEqual(checkLinkedInRequest(request), null, JSON.stringify(request));
});

// ── Captured query ids ──────────────────────────────────────────────────────

test("the extension reads query ids and variable names from LinkedIn's own requests", () => {
  const conversations = parseCapturedQuery(
    `https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.${"8".repeat(32)}&variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,mailboxUrn:urn%3Ali%3Afsd_profile%3AACoAA,lastUpdatedBefore:1730000000000)`,
  );
  assert.deepEqual(conversations, {
    name: "messengerConversations",
    queryId: `messengerConversations.${"8".repeat(32)}`,
    variables: ["query", "count", "mailboxUrn", "lastUpdatedBefore"],
  });
  const messages = parseCapturedQuery(
    `https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.${"9".repeat(32)}&variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28x%29)`,
  );
  assert.deepEqual(messages?.variables, ["conversationUrn"]);
  assert.equal(parseCapturedQuery("https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=evil.1"), null);
  assert.deepEqual(topLevelKeys("a:1,b:(c:2,d:(e:3)),f:x"), ["a", "b", "f"]);
});

test("reported query ids are validated, deduplicated and bounded", () => {
  const id = (n: number) => `messengerConversations.${n.toString(16).padStart(32, "0")}`;
  const merged = mergeCapturedQueries(
    { messengerConversations: [{ queryId: id(1), variables: ["mailboxUrn"] }] },
    {
      messengerConversations: [
        { queryId: id(2), variables: ["mailboxUrn"] },
        { queryId: id(1), variables: ["mailboxUrn"] },
        { queryId: "messengerMessages." + "a".repeat(32), variables: [] },
        { queryId: id(3), variables: ["bad-name"] },
        ...[4, 5, 6, 7, 8, 9].map((n) => ({ queryId: id(n), variables: ["mailboxUrn"] })),
      ],
      evilQuery: [{ queryId: "x", variables: [] }],
    },
  );
  assert.deepEqual(Object.keys(merged), ["messengerConversations"]);
  assert.equal(merged.messengerConversations.length, 6);
  assert.equal(merged.messengerConversations[0].queryId, id(2));
  assert.equal(new Set(merged.messengerConversations.map((q) => q.queryId)).size, 6);
});

// ── Parsers ─────────────────────────────────────────────────────────────────

test("identity from /voyager/api/me, plain and normalized", () => {
  const plain = {
    plainId: 1,
    miniProfile: {
      firstName: "Michael",
      lastName: "Bernard",
      publicIdentifier: "michael-bernard",
      occupation: "Recruiter",
      entityUrn: `urn:li:fs_miniProfile:${SELF}`,
      dashEntityUrn: `urn:li:fsd_profile:${SELF}`,
    },
  };
  assert.deepEqual(parseIdentity(plain), {
    memberId: SELF,
    firstName: "Michael",
    lastName: "Bernard",
    publicIdentifier: "michael-bernard",
    headline: "Recruiter",
  });
  const normalized = {
    data: { "*miniProfile": `urn:li:fs_miniProfile:${SELF}`, plainId: 1 },
    included: [{ entityUrn: `urn:li:fs_miniProfile:${SELF}`, firstName: "Michael", lastName: "Bernard", publicIdentifier: "michael-bernard" }],
  };
  assert.equal(parseIdentity(normalized)?.memberId, SELF);
  assert.equal(parseIdentity({ data: {} }), null);
  assert.equal(parseIdentity(null), null);
});

const nestedInbox = {
  data: {
    messengerConversationsBySyncToken: {
      metadata: { newSyncToken: "sync" },
      elements: [
        {
          entityUrn: CONV2,
          lastActivityAt: 1720000000000,
          read: true,
          groupChat: false,
          conversationParticipants: [
            { entityUrn: PART_SELF, participantType: member("Michael", "Bernard") },
            { entityUrn: PART_OTHER, participantType: member("Jane", "Doe") },
          ],
          messages: { elements: [] },
        },
        {
          entityUrn: CONV1,
          lastActivityAt: 1730000000000,
          read: false,
          groupChat: false,
          conversationParticipants: [
            { entityUrn: PART_SELF, hostIdentityUrn: `urn:li:fsd_profile:${SELF}`, participantType: member("Michael", "Bernard") },
            {
              entityUrn: PART_OTHER,
              hostIdentityUrn: `urn:li:fsd_profile:${OTHER}`,
              participantType: member("Jane", "Doe", { profileUrl: "https://www.linkedin.com/in/jane-doe", headline: { text: "Data engineer" } }),
            },
          ],
          messages: {
            elements: [
              {
                entityUrn: msgUrn("M1"),
                deliveredAt: 1730000000000,
                body: { text: "Hello Michael" },
                sender: { entityUrn: PART_OTHER, participantType: member("Jane", "Doe") },
              },
            ],
          },
        },
      ],
    },
  },
};

test("inbox page (nested GraphQL): participants without self, unread, embedded message", () => {
  const [first, second] = parseConversations(nestedInbox, SELF);
  assert.equal(first.urn, CONV1, "most recent first");
  assert.equal(first.unread, true);
  assert.deepEqual(first.participants, [
    { memberId: OTHER, name: "Jane Doe", profileUrl: "https://www.linkedin.com/in/jane-doe", headline: "Data engineer" },
  ]);
  assert.deepEqual(first.messages, [
    {
      urn: msgUrn("M1"),
      conversationUrn: CONV1,
      senderMemberId: OTHER,
      senderName: "Jane Doe",
      direction: "inbound",
      body: "Hello Michael",
      sentAt: 1730000000000,
    },
  ]);
  assert.equal(second.urn, CONV2);
  assert.equal(second.unread, false);
});

const normalizedThread = {
  data: { data: { messengerMessagesByAnchorTimestamp: { "*elements": [msgUrn("B"), msgUrn("A"), msgUrn("C"), msgUrn("D")] } } },
  included: [
    { entityUrn: msgUrn("A"), deliveredAt: 1000, body: { text: "first" }, "*sender": PART_OTHER, "*conversation": CONV1 },
    { entityUrn: msgUrn("B"), deliveredAt: 2000, body: { text: "" }, "*sender": PART_SELF, "*conversation": CONV1, renderContent: [{ file: { name: "cv.pdf" } }] },
    { entityUrn: msgUrn("C"), deliveredAt: 3000, body: { text: "other thread" }, "*sender": PART_OTHER, "*conversation": CONV2 },
    { entityUrn: msgUrn("D"), deliveredAt: 4000, body: { text: "oops" }, messageBodyRenderFormat: "RECALLED", "*sender": PART_OTHER, "*conversation": CONV1 },
    { entityUrn: PART_OTHER, participantType: member("Jane", "Doe") },
    { entityUrn: PART_SELF, participantType: member("Michael", "Bernard") },
    { entityUrn: CONV1 },
    { entityUrn: CONV2 },
  ],
};

test("thread (normalized JSON): references resolved, own messages outbound, attachments described", () => {
  const messages = parseMessages(normalizedThread, SELF, CONV1);
  assert.deepEqual(
    messages.map((m) => [m.body, m.direction, m.senderName]),
    [
      ["first", "inbound", "Jane Doe"],
      ["[file: cv.pdf]", "outbound", "Michael Bernard"],
      ["[message deleted]", "inbound", "Jane Doe"],
    ],
  );
  // Message stubs never surface as conversations.
  assert.deepEqual(parseConversations(normalizedThread, SELF), []);
});

test("send result and profile lookup", () => {
  const sent = parseSendResult(
    { value: { entityUrn: msgUrn("NEW"), deliveredAt: 1730000001000, conversation: { entityUrn: CONV1 }, body: { text: "hi" } } },
    "",
  );
  assert.deepEqual(sent, { messageUrn: msgUrn("NEW"), conversationUrn: CONV1, sentAt: 1730000001000 });
  const raw = `{"value":{"entityUrn":"${msgUrn("X")}","backendConversationUrn":"${CONV2}"}}`;
  assert.equal(parseSendResult(JSON.parse(raw), raw).conversationUrn, CONV2);

  const lookup = {
    data: { "*elements": [`urn:li:fsd_profile:${OTHER}`] },
    included: [
      { entityUrn: `urn:li:fsd_profile:${SELF}`, publicIdentifier: "michael-bernard", firstName: "Michael", lastName: "Bernard" },
      { entityUrn: `urn:li:fsd_profile:${OTHER}`, publicIdentifier: "Jane-Doe", firstName: "Jane", lastName: "Doe" },
    ],
  };
  assert.deepEqual(parseProfileLookup(lookup, "jane-doe"), { memberId: OTHER, name: "Jane Doe" });
  assert.equal(parseProfileLookup(lookup, "someone-else"), null, "two candidates and no exact match: refuse to guess");
});

// ── Policy and planner ──────────────────────────────────────────────────────

test("feature flag and policy bounds", () => {
  assert.equal(linkedInBridgeEnabled({} as unknown as NodeJS.ProcessEnv), false);
  assert.equal(linkedInBridgeEnabled({ LINKEDIN_BRIDGE_ENABLED: "1" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(linkedInBridgeEnabled({ LINKEDIN_BRIDGE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv), true);
  const policy = readBridgePolicy({ LINKEDIN_BRIDGE_DAILY_SEND_CAP: "9999", LINKEDIN_BRIDGE_MIN_SEND_INTERVAL_SECONDS: "1" } as unknown as NodeJS.ProcessEnv);
  assert.equal(policy.dailySendCap, 150);
  assert.equal(policy.minSendIntervalMs, 20_000);
  assert.equal(readBridgePolicy({} as unknown as NodeJS.ProcessEnv).dailySendCap, 40);
});

test("send pacing: daily cap and minimum gap", () => {
  const policy = { dailySendCap: 3, minSendIntervalMs: 90_000 };
  const now = 10 * 24 * 3600_000;
  assert.deepEqual(sendSlot({ now, recentSends: [], policy }), { allowed: true });
  assert.deepEqual(sendSlot({ now, recentSends: [now - 30_000], policy }), { allowed: false, reason: "min_interval", retryAt: now + 60_000 });
  const capped = sendSlot({ now, recentSends: [now - 5 * 3600_000, now - 3 * 3600_000, now - 3600_000], policy });
  assert.deepEqual(capped, { allowed: false, reason: "daily_cap", retryAt: now - 5 * 3600_000 + 24 * 3600_000 });
  assert.deepEqual(sendSlot({ now, recentSends: [now - 25 * 3600_000, now - 3600_000], policy }), { allowed: true });
});

function plan(overrides: Omit<Partial<PlanInput>, "account"> & { account?: Partial<PlanInput["account"]> } = {}) {
  const now = 1_730_000_000_000;
  const { account, ...rest } = overrides;
  return planTasks({
    now,
    policy: { inboxSyncIntervalMs: 180_000 },
    account: { memberId: SELF, identityCheckedAt: now - 1000, lastInboxSyncAt: now - 10_000, backoffUntil: null, queries: null, ...account },
    sessionPresent: true,
    threadsToRefresh: [],
    nextSend: null,
    sendSlot: { allowed: true },
    trackingId: () => "TRACKINGID000000",
    ...rest,
  });
}

test("planner: nothing without a session or during a backoff", () => {
  assert.deepEqual(plan({ sessionPresent: false, nextSend: { id: "a", body: "x", conversationUrn: CONV1, recipientMemberId: null, recipientPublicId: null } }), []);
  assert.deepEqual(plan({ account: { backoffUntil: 1_730_000_000_000 + 1 } }), []);
  assert.deepEqual(plan(), [], "fresh state: nothing to do");
});

test("planner: identity first, then the inbox, threads and the waiting send", () => {
  assert.deepEqual(plan({ account: { memberId: null } }).map((t) => t.op), ["identity"]);
  const tasks = plan({
    account: { lastInboxSyncAt: null, identityCheckedAt: null },
    threadsToRefresh: [CONV1, CONV2],
    nextSend: { id: "11111111-1111-4111-8111-111111111111", body: "Hello", conversationUrn: CONV1, recipientMemberId: null, recipientPublicId: null },
  });
  assert.deepEqual(tasks.map((t) => t.op), ["identity", "send", "conversations", "messages", "messages"]);
  const send = tasks[1];
  assert.equal(send.ref, "11111111-1111-4111-8111-111111111111");
  assert.equal(JSON.parse(send.request.body!).message.originToken, send.ref);
  assert.deepEqual(tasks.slice(3).map((t) => t.ref), [CONV1, CONV2]);
});

test("planner: a new chat resolves the profile first; pacing holds the send", () => {
  const pending = { id: "s", body: "Hi", conversationUrn: null, recipientMemberId: null, recipientPublicId: "jane-doe" };
  assert.deepEqual(plan({ nextSend: pending }).map((t) => t.op), ["resolveProfile"]);
  const resolved = plan({ nextSend: { ...pending, recipientMemberId: OTHER } });
  assert.deepEqual(JSON.parse(resolved[0].request.body!).hostRecipientUrns, [`urn:li:fsd_profile:${OTHER}`]);
  assert.deepEqual(plan({ nextSend: pending, sendSlot: { allowed: false, reason: "min_interval", retryAt: 0 } }), []);
});

// ── Tokens and answers ──────────────────────────────────────────────────────

test("pairing tokens", () => {
  const { token, hash } = generateBridgeToken();
  assert.match(token, /^aria_lnb_[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashBridgeToken(token));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(bridgeTokenFromHeader(`Bearer ${token}`), token);
  assert.equal(bridgeTokenFromHeader(token), null);
  assert.equal(bridgeTokenFromHeader("Bearer aria_lnb_short"), null);
  assert.equal(bridgeTokenFromHeader(null), null);
  assert.match(randomTrackingId(), /^[A-Za-z0-9]{16}$/);
});

test("LinkedIn answers are classified before any parsing", () => {
  assert.deepEqual(classifyAnswer({ status: 200, body: '{"a":1}' }), { kind: "ok", json: { a: 1 } });
  assert.equal(classifyAnswer({ status: 0, body: "", error: "Failed to fetch" }).kind, "transport");
  assert.equal(classifyAnswer({ status: 401, body: "" }).kind, "session");
  assert.equal(classifyAnswer({ status: 403, body: "" }).kind, "session");
  assert.equal(classifyAnswer({ status: 429, body: "" }).kind, "throttled");
  assert.equal(classifyAnswer({ status: 999, body: "" }).kind, "throttled");
  assert.equal(classifyAnswer({ status: 200, body: "<html>", finalUrl: "https://www.linkedin.com/checkpoint/challenge" }).kind, "challenge");
  assert.equal(classifyAnswer({ status: 200, body: "<!DOCTYPE html><html></html>" }).kind, "challenge");
  const refused = classifyAnswer({ status: 422, body: '{"message":"You can only message your connections","status":422}' });
  assert.deepEqual(refused, { kind: "error", status: 422, detail: "LinkedIn: You can only message your connections" });
  assert.equal(graphqlErrors({ errors: [{ message: "Unknown queryId" }] }), "Unknown queryId");
  assert.equal(graphqlErrors({ data: {} }), null);
});

// ── Structural guarantees ───────────────────────────────────────────────────

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

test("the bridge is isolated: only its own routes import it", () => {
  const offenders = sourceFiles("src")
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !path.startsWith("src/lib/linkedin-bridge/") && !path.startsWith("src/app/api/linkedin/"))
    .filter((path) => /(?:from|import)\s*\(?\s*["'][^"']*linkedin-bridge/.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});

test("only a signed-in person can queue a message; the extension cannot", () => {
  const outbox = readFileSync("src/app/api/linkedin/outbox/route.ts", "utf8");
  assert.match(outbox, /requireBridgeUser/);
  assert.doesNotMatch(outbox, /requireBridgeExtension/);
  for (const route of ["src/app/api/linkedin/bridge/poll/route.ts", "src/app/api/linkedin/bridge/result/route.ts"]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireBridgeExtension/);
    assert.doesNotMatch(source, /requireBridgeUser|from\("linkedin_bridge_outbox"\)\s*\.insert/);
  }
  const callers = sourceFiles("src")
    .filter((path) => readFileSync(path, "utf8").includes("/api/linkedin/outbox"))
    .map((path) => path.replaceAll("\\", "/"));
  assert.deepEqual(callers, ["src/app/linkedin/page.tsx"]);
});

test("no LinkedIn credential is stored or relayed", () => {
  const migration = readFileSync("supabase/migrations/0006_linkedin_bridge.sql", "utf8");
  assert.doesNotMatch(migration, /li_at|jsessionid|cookie\s+text|password\s+text/i);
  for (const table of ["linkedin_bridge_accounts", "linkedin_bridge_conversations", "linkedin_bridge_messages", "linkedin_bridge_outbox"]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on public\.%I from public, anon, authenticated, authenticator/);

  const background = readFileSync("extensions/linkedin-bridge/background.js", "utf8");
  assert.match(background, /checkLinkedInRequest\(task && task\.request\)/, "allowlist checked before any LinkedIn call");
  assert.equal((background.match(/liAt\.value/g) ?? []).length, 1, "the li_at value is only tested for presence");
  assert.match(background, /present: Boolean\(liAt && liAt\.value\)/);
  assert.doesNotMatch(background, /csrf[^\n]*JSON\.stringify|aria\([^)]*csrf/);

  const manifest = JSON.parse(readFileSync("extensions/linkedin-bridge/manifest.json", "utf8")) as Record<string, string[]>;
  assert.deepEqual(manifest.host_permissions, ["https://www.linkedin.com/*", "http://localhost/*", "http://127.0.0.1/*"]);
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
});
