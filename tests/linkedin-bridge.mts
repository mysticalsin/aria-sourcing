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
  isNotConnectedRefusal,
  parseConversations,
  parseIdentity,
  parseInvitationResult,
  parseMessages,
  parseProfileCard,
  parseProfileLookup,
  parseSendResult,
} from "../src/lib/linkedin-bridge/parse.ts";
import { planTasks, type PlanInput } from "../src/lib/linkedin-bridge/planner.ts";
import { linkedInProfileUrl } from "../src/lib/linkedin-profile-url.ts";
import { linkedInBridgeEnabled, readBridgePolicy, sendSlot, writeSlot } from "../src/lib/linkedin-bridge/policy.ts";
import { bridgeTokenFromHeader, generateBridgeToken, hashBridgeToken, randomTrackingId } from "../src/lib/linkedin-bridge/token.ts";
import {
  FALLBACK_QUERIES,
  INVITATION_NOTE_LIMIT,
  buildConversationsRequest,
  buildInvitationRequest,
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
    buildProfileLookupRequest(OTHER),
    buildInvitationRequest({ recipientMemberId: OTHER }),
    buildInvitationRequest({ recipientMemberId: OTHER, note: "Hi Jane, happy to connect." }),
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
    { method: "GET", path: "/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=a", headers: {} },
    { method: "POST", path: "/voyager/api/voyagerRelationshipsDashMemberRelationships?action=withdraw", headers: {}, body: "{}" },
    { method: "GET", path: "/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2", headers: {} },
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
  // data["*elements"] names the subject; the answer also carries our own profile.
  assert.equal(parseProfileLookup(lookup, "anything")?.memberId, OTHER);
  const unnamed = { included: lookup.included };
  assert.equal(parseProfileLookup(unnamed, "someone-else"), null, "no subject and no exact match: refuse to guess");
  assert.equal(parseProfileLookup(unnamed, "jane-doe")?.memberId, OTHER);
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
    policy: { inboxSyncIntervalMs: 180_000, liveInboxSyncIntervalMs: 30_000, activitySyncMinGapMs: 15_000 },
    account: { memberId: SELF, identityCheckedAt: now - 1000, lastInboxSyncAt: now - 10_000, backoffUntil: null, queries: null, ...account },
    sessionPresent: true,
    live: false,
    linkedInActivity: false,
    threadsToRefresh: [],
    contactsToCheck: [],
    nextSend: null,
    sendSlot: { allowed: true },
    trackingId: () => "TRACKINGID000000",
    ...rest,
  });
}

test("planner: nothing without a session or during a backoff", () => {
  assert.deepEqual(plan({ sessionPresent: false, nextSend: { id: "a", kind: "message", body: "x", conversationUrn: CONV1, recipientMemberId: null, recipientPublicId: null } }), []);
  assert.deepEqual(plan({ account: { backoffUntil: 1_730_000_000_000 + 1 } }), []);
  assert.deepEqual(plan(), [], "fresh state: nothing to do");
});

test("planner: identity first, then the inbox, threads and the waiting send", () => {
  assert.deepEqual(plan({ account: { memberId: null } }).map((t) => t.op), ["identity"]);
  const tasks = plan({
    account: { lastInboxSyncAt: null, identityCheckedAt: null },
    threadsToRefresh: [CONV1, CONV2],
    nextSend: { id: "11111111-1111-4111-8111-111111111111", kind: "message", body: "Hello", conversationUrn: CONV1, recipientMemberId: null, recipientPublicId: null },
  });
  assert.deepEqual(tasks.map((t) => t.op), ["identity", "send", "conversations", "messages", "messages"]);
  const send = tasks[1];
  assert.equal(send.ref, "11111111-1111-4111-8111-111111111111");
  assert.equal(JSON.parse(send.request.body!).message.originToken, send.ref);
  assert.deepEqual(tasks.slice(3).map((t) => t.ref), [CONV1, CONV2]);
});

test("planner: a new chat resolves the profile first; pacing holds the send", () => {
  const pending = { id: "s", kind: "message" as const, body: "Hi", conversationUrn: null, recipientMemberId: null, recipientPublicId: "jane-doe" };
  assert.deepEqual(plan({ nextSend: pending }).map((t) => t.op), ["resolveProfile"]);
  const resolved = plan({ nextSend: { ...pending, recipientMemberId: OTHER } });
  assert.deepEqual(JSON.parse(resolved[0].request.body!).hostRecipientUrns, [`urn:li:fsd_profile:${OTHER}`]);
  assert.deepEqual(plan({ nextSend: pending, sendSlot: { allowed: false, reason: "min_interval", retryAt: 0 } }), []);
});

test("planner: faster inbox refresh while the ARIA page is open, and on LinkedIn activity", () => {
  const now = 1_730_000_000_000;
  assert.deepEqual(plan({ account: { lastInboxSyncAt: now - 40_000 } }).map((t) => t.op), [], "3 min interval by default");
  assert.deepEqual(plan({ live: true, account: { lastInboxSyncAt: now - 40_000 } }).map((t) => t.op), ["conversations"]);
  assert.deepEqual(plan({ live: true, account: { lastInboxSyncAt: now - 10_000 } }).map((t) => t.op), []);
  assert.deepEqual(plan({ linkedInActivity: true, account: { lastInboxSyncAt: now - 20_000 } }).map((t) => t.op), ["conversations"]);
  assert.deepEqual(plan({ linkedInActivity: true, account: { lastInboxSyncAt: now - 5_000 } }).map((t) => t.op), [], "activity is debounced");
});

// ── Candidates: relationship, invitations ───────────────────────────────────

const card = (relationship: Record<string, unknown> | null) => ({
  data: { "*elements": [`urn:li:fsd_profile:${OTHER}`] },
  included: [
    { entityUrn: `urn:li:fsd_profile:${SELF}`, publicIdentifier: "me", firstName: "Michael", lastName: "Bernard" },
    { entityUrn: `urn:li:fsd_profile:${OTHER}`, publicIdentifier: "jane-doe", firstName: "Jane", lastName: "Doe", headline: "Data engineer" },
    ...(relationship ? [{ entityUrn: `urn:li:fsd_memberRelationship:${OTHER}`, ...relationship }] : []),
  ],
});

test("profile card: subject, and where they stand with the user", () => {
  const connected = parseProfileCard(card({ memberRelationshipUnion: { connection: { createdAt: 1 } } }), "jane-doe");
  assert.deepEqual(connected, { memberId: OTHER, publicIdentifier: "jane-doe", name: "Jane Doe", headline: "Data engineer", relationship: "connected" });
  assert.equal(parseProfileCard(card({ memberRelationshipUnion: { noConnection: { invitationUnion: { noInvitation: {} }, memberDistance: "DISTANCE_2" } } }), "jane-doe")?.relationship, "none");
  assert.equal(parseProfileCard(card({ memberRelationshipUnion: { noConnection: { invitationUnion: { invitation: { "*invitation": "urn:li:fsd_invitation:1" } } } } }), "jane-doe")?.relationship, "pending");
  assert.equal(parseProfileCard(card({ memberRelationshipUnion: { noConnection: { memberDistance: "DISTANCE_1" } } }), "jane-doe")?.relationship, "connected");
  assert.equal(parseProfileCard(card(null), "jane-doe")?.relationship, "unknown", "no MemberRelationship: unknown, not 'none'");
  assert.equal(parseProfileCard({ data: {} }, "jane-doe"), null);
});

test("invitation request: LinkedIn's Connect dialog payload, note optional", () => {
  const bare = buildInvitationRequest({ recipientMemberId: OTHER });
  assert.equal(bare.method, "POST");
  assert.deepEqual(JSON.parse(bare.body!), { invitee: { inviteeUnion: { memberProfile: `urn:li:fsd_profile:${OTHER}` } } });
  assert.equal(bare.headers["content-type"], "application/json");
  const noted = JSON.parse(buildInvitationRequest({ recipientMemberId: OTHER, note: "  Hi Jane  " }).body!);
  assert.equal(noted.customMessage, "Hi Jane");
  assert.throws(() => buildInvitationRequest({ recipientMemberId: OTHER, note: "x".repeat(INVITATION_NOTE_LIMIT + 1) }));
  assert.match(buildProfileLookupRequest("jane-doe").path, /decorationId=com\.linkedin\.voyager\.dash\.deco\.identity\.profile\.WebTopCardCore-19$/);
});

test("invitation answers are classified", () => {
  assert.deepEqual(parseInvitationResult(201, JSON.stringify({ data: { value: { "*invitation": "urn:li:fsd_invitation:9" } } })), {
    kind: "sent",
    invitationUrn: "urn:li:fsd_invitation:9",
  });
  assert.equal(parseInvitationResult(400, '{"data":{"code":"CANT_RESEND_YET","status":400}}').kind, "already_pending");
  assert.equal(parseInvitationResult(400, "CANT_RESEND_YET").kind, "already_pending");
  assert.equal(parseInvitationResult(200, '{"data":{"code":"WEEKLY_INVITATION_LIMIT_REACHED"}}').kind, "quota");
  assert.equal(parseInvitationResult(422, '{"message":"Something else"}').kind, "refused");
  assert.equal(isNotConnectedRefusal(422, '{"code":"RECIPIENT_NOT_FIRST_DEGREE_CONNECTION"}'), true);
  assert.equal(isNotConnectedRefusal(500, "RECIPIENT_NOT_FIRST_DEGREE_CONNECTION"), false);
});

test("write pacing: one gap across kinds, caps per kind", () => {
  const day = 24 * 3600_000;
  const now = 30 * day;
  const policy = { dailySendCap: 40, minSendIntervalMs: 90_000, dailyInviteCap: 2, weeklyInviteCap: 3 };
  assert.deepEqual(writeSlot({ now, kind: "invitation", recent: [], policy }), { allowed: true });
  assert.equal(writeSlot({ now, kind: "invitation", recent: [{ kind: "message", at: now - 10_000 }], policy }).allowed, false, "gap shared with messages");
  const daily = writeSlot({ now, kind: "invitation", recent: [{ kind: "invitation", at: now - 5 * 3600_000 }, { kind: "invitation", at: now - 3600_000 }], policy });
  assert.deepEqual(daily, { allowed: false, reason: "daily_cap", retryAt: now - 5 * 3600_000 + day });
  const weekly = writeSlot({ now, kind: "invitation", recent: [1, 2, 3].map((d) => ({ kind: "invitation" as const, at: now - d * day - 1000 })), policy });
  assert.equal(weekly.allowed, false, "weekly invitation cap");
  assert.deepEqual(writeSlot({ now, kind: "message", recent: [1, 2, 3].map((d) => ({ kind: "invitation" as const, at: now - d * day - 1000 })), policy }), { allowed: true });
});

test("planner: invitations, and candidate look-ups", () => {
  const invite = { id: "i", kind: "invitation" as const, body: "", conversationUrn: null, recipientMemberId: OTHER, recipientPublicId: null };
  const tasks = plan({ nextSend: invite, contactsToCheck: [{ id: "c1", identity: "jane-doe" }] });
  assert.deepEqual(tasks.map((t) => [t.op, t.ref]), [["invite", "i"], ["lookupContact", "c1"]]);
  assert.equal(checkLinkedInRequest(tasks[0].request), null);
  assert.equal(checkLinkedInRequest(tasks[1].request), null);
  assert.deepEqual(plan({ nextSend: { ...invite, recipientMemberId: null, recipientPublicId: "jane-doe" } }).map((t) => t.op), ["resolveProfile"]);
  assert.deepEqual(plan({ nextSend: invite, sendSlot: { allowed: false, reason: "daily_cap", retryAt: 0 } }).map((t) => t.op), []);
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

test("the bridge is isolated: only its own routes import it, and the agents only its agent entry point", () => {
  const offenders = sourceFiles("src")
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !path.startsWith("src/lib/linkedin-bridge/") && !path.startsWith("src/app/api/linkedin/"))
    .filter((path) => {
      const imports = [...readFileSync(path, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']*linkedin-bridge[^"']*)["']/g)].map((m) => m[1]);
      if (!imports.length) return false;
      // ADR 0002: the agents runner reaches the bridge through agent.ts (and reads the on/off flag).
      const agentSide = path.startsWith("src/lib/agents/server/") || path.startsWith("src/app/api/agent/");
      return !agentSide || imports.some((spec) => !/linkedin-bridge\/(?:agent|policy)$/.test(spec));
    });
  assert.deepEqual(offenders, []);
});

test("the agents queue only through agent.ts, under the owner's standing approval and delegation (ADR 0002)", () => {
  const all = sourceFiles("src").map((path) => path.replaceAll("\\", "/"));
  const inserters = all.filter((path) => /from\("linkedin_bridge_outbox"\)\s*\.insert/.test(readFileSync(path, "utf8"))).sort();
  assert.deepEqual(inserters, ["src/app/api/linkedin/candidates/route.ts", "src/lib/linkedin-bridge/agent.ts"]);
  const agent = readFileSync("src/lib/linkedin-bridge/agent.ts", "utf8");
  const queue = agent.slice(agent.indexOf("export async function agentQueue"));
  // Authority first, then the candidate as the workspace holds it, then the relationship rules.
  const order = ["agentMayQueue(svc, approval)", "candidateRecord(svc, approval.workspaceId", "contactBlock(candidate)", "INVITATION_NOTE_MAX", '.from("linkedin_bridge_outbox").insert('];
  let at = -1;
  for (const needle of order) {
    const next = queue.indexOf(needle);
    assert.ok(next > at, `agentQueue checks ${needle} in order`);
    at = next;
  }
  for (const needle of ['"agent_campaign_autopilots"', "contact_enabled === true", "owner_id === approval.ownerId", "revoked_at === null", 'includes("queue_linkedin")', "linkedInBridgeEnabled()"]) {
    assert.ok(agent.includes(needle), `agentMayQueue checks ${needle}`);
  }
  const callers = all.filter((path) => /\bagentQueue\(/.test(readFileSync(path, "utf8")) && path !== "src/lib/linkedin-bridge/agent.ts");
  assert.deepEqual(callers, ["src/lib/agents/server/deps.ts"]);
  // The runner route is the only way in, by its shared secret.
  const tick = readFileSync("src/app/api/agent/tick/route.ts", "utf8");
  assert.match(tick, /if \(!runnerAuthorized\(req\)\) return json\(\{ ok: false \}, 401\)/);
});

test("only a signed-in person can queue a message or an invitation; the extension cannot", () => {
  for (const route of ["src/app/api/linkedin/candidates/route.ts"]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireBridgeUser/);
    assert.doesNotMatch(source, /requireBridgeExtension/);
    // The candidate comes from the workspace state, and its compliance flags are checked.
    assert.match(source, /candidateRecord\(svc, workspaceId,/);
    assert.match(source, /contactBlock\(candidate\)/);
  }
  const outbox = readFileSync("src/app/api/linkedin/outbox/route.ts", "utf8");
  assert.match(outbox, /requireBridgeUser/);
  assert.match(outbox, /status: 410/);
  assert.doesNotMatch(outbox, /\.insert\(/);
  for (const route of ["src/app/api/linkedin/bridge/poll/route.ts", "src/app/api/linkedin/bridge/result/route.ts"]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /requireBridgeExtension/);
    assert.doesNotMatch(source, /requireBridgeUser|from\("linkedin_bridge_outbox"\)\s*\.insert/);
  }
  const all = sourceFiles("src").map((path) => path.replaceAll("\\", "/"));
  const outside = (needle: string) =>
    all.filter((path) => readFileSync(path, "utf8").includes(needle)).filter((path) => !path.startsWith("src/components/linkedin/"));
  assert.deepEqual(outside("/api/linkedin/outbox"), [], "only the LinkedIn components queue messages");
  assert.deepEqual(outside('"/api/linkedin/candidates"'), [], "only the LinkedIn components queue invitations");
  assert.deepEqual(outside("linkedin-store"), [], "no agent, mission or store action reaches the LinkedIn actions");
  // Each write sits in a click handler.
  const thread = readFileSync("src/components/linkedin/thread-view.tsx", "utf8");
  assert.match(thread, /async function send\(text: string\)/);
  const panel = readFileSync("src/components/linkedin/candidate-linkedin.tsx", "utf8");
  assert.match(panel, /onInvite=\{async \(note\) => \{\s*const ok = await act\(\(\) => inviteCandidate\(candidateId, note\)/);
  assert.match(panel, /onSend=\{async \(text\) => \{\s*if \(await act\(\(\) => messageCandidate\(candidateId, text\)/);
  // An approved outreach draft is only prefilled: the composer sends on submit (a click or Ctrl+Enter).
  const composer = readFileSync("src/components/linkedin/composer.tsx", "utf8");
  assert.match(composer, /const \[text, setText\] = React\.useState\(initialText\)/);
  assert.match(composer, /<form onSubmit=\{submit\}/);
  assert.equal((composer.match(/onSend\(/g) ?? []).length, 1, "one send path");
  const usesOf = (name: string) => all.filter((path) => new RegExp(`\\b${name}\\(`).test(readFileSync(path, "utf8")));
  // The candidate's LinkedIn tab, and the approval of an exact outreach
  // message (owner, 2026-11-09: approving a LinkedIn message sends it).
  const senders = ["src/components/linkedin/candidate-linkedin.tsx", "src/components/linkedin/linkedin-store.ts", "src/components/linkedin/outreach-send.ts"];
  assert.deepEqual(usesOf("inviteCandidate").sort(), senders);
  assert.deepEqual(usesOf("messageCandidate").sort(), senders);
  assert.deepEqual(
    all.filter((path) => readFileSync(path, "utf8").includes("useDeliverApprovedLinkedIn(")).sort(),
    ["src/app/outreach/page.tsx", "src/components/linkedin/outreach-send.ts", "src/components/outreach/glass-box-panel.tsx", "src/components/outreach/outreach-message-card.tsx"],
    "only the approval of an outreach message sends it on LinkedIn",
  );
  for (const path of ["src/components/outreach/glass-box-panel.tsx", "src/components/outreach/outreach-message-card.tsx"]) {
    // Sent right after the approval succeeded, never before or without it.
    assert.match(readFileSync(path, "utf8"), /const res = await (?:a|actions)\.approveOutreach\(message\.id\);[\s\S]*if \(!res\.allowed\)[\s\S]*if \(message\.channel === "LinkedIn"\) \{[\s\S]*await deliverOnLinkedIn\(message\)/, path);
  }
});

test("every LinkedIn write from the browser must come from this app (same origin, Docker-safe)", () => {
  const server = readFileSync("src/lib/linkedin-bridge/server.ts", "utf8");
  assert.match(server, /if \(options\.mutation && !isSameOriginRequest\(req\)\)/);
  const userRoutes = ["account", "conversations", "conversations/[id]", "outbox", "candidates", "stream"];
  for (const name of userRoutes) {
    const source = readFileSync(`src/app/api/linkedin/${name}/route.ts`, "utf8");
    for (const match of source.matchAll(/export async function (GET|POST|DELETE|PATCH|PUT)\(req[^)]*\)[^{]*\{\n  const auth = await requireBridgeUser\(req(, \{ mutation: true \})?\);/g)) {
      const write = match[1] !== "GET";
      assert.equal(Boolean(match[2]), write, `${name} ${match[1]}: mutation guard ${write ? "required" : "not expected"}`);
    }
    assert.equal(
      (source.match(/export async function (POST|DELETE|PATCH|PUT)\(/g) ?? []).length,
      (source.match(/requireBridgeUser\(req, \{ mutation: true \}\)/g) ?? []).length,
      `${name}: every write handler is guarded`,
    );
  }
  // The extension authenticates with its pairing token, from chrome-extension://.
  for (const route of ["bridge/poll", "bridge/result"]) {
    assert.doesNotMatch(readFileSync(`src/app/api/linkedin/${route}/route.ts`, "utf8"), /isSameOriginRequest|mutation: true/);
  }
});

test("candidate data: only candidates' conversations are kept, one LinkedIn account per user", () => {
  const migration = readFileSync("supabase/migrations/0008_linkedin_bridge_candidates.sql", "utf8");
  assert.match(migration, /create unique index linkedin_bridge_accounts_member\s+on public\.linkedin_bridge_accounts\(member_id\) where member_id is not null/);
  assert.match(migration, /alter table public\.linkedin_bridge_contacts force row level security/);
  assert.match(migration, /revoke all on public\.linkedin_bridge_contacts from public, anon, authenticated, authenticator/);
  assert.match(migration, /revoke all on function public\.linkedin_bridge_candidate\(uuid, text\) from public, anon, authenticated;\s*grant execute on function public\.linkedin_bridge_candidate\(uuid, text\) to service_role;/);
  assert.match(migration, /delete from public\.linkedin_bridge_messages;/);
  const server = readFileSync("src/lib/linkedin-bridge/server.ts", "utf8");
  // A conversation without a candidate keeps member ids only.
  assert.match(server, /participants: c\.participants\.filter\(\(p\) => p\.memberId\)\.slice\(0, 50\)\.map\(\(p\) => \(\{ memberId: p\.memberId \}\)\)/);
  for (const route of ["src/app/api/linkedin/conversations/route.ts", "src/app/api/linkedin/conversations/[id]/route.ts"]) {
    assert.match(readFileSync(route, "utf8"), /\.not\("candidate_id", "is", null\)/, `${route} shows candidates' conversations only`);
  }
  const result = readFileSync("src/app/api/linkedin/bridge/result/route.ts", "utf8");
  assert.match(result, /already connected to another ARIA user/);
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

  // One-click pairing and page signals only from the configured ARIA origin.
  const pairCase = background.slice(background.indexOf('case "pair":'), background.indexOf('case "linkedin-activity":'));
  assert.match(pairCase, /if \(!fromAria\) return/);
  assert.match(background, /const fromAria = fromTab && senderOrigin !== null && senderOrigin === \(await ariaOrigin\(\)\)/);
  assert.match(background, /case "linkedin-activity":\s*\n\s*if \(!fromTab \|\| senderOrigin !== LINKEDIN_ORIGIN\) return/);
  assert.match(background, /sender\.id !== chrome\.runtime\.id/);
  const publicStatus = background.slice(background.indexOf("async function publicStatus"), background.indexOf("async function broadcastStatus"));
  assert.doesNotMatch(publicStatus, /token:|csrf|li_at/, "the status shared with pages carries no secret");

  const pageRelay = readFileSync("extensions/linkedin-bridge/aria-page.js", "utf8");
  assert.match(pageRelay, /event\.source !== window \|\| event\.origin !== window\.location\.origin/);
  assert.match(pageRelay, /window\.postMessage\(\{ source: FROM_EXTENSION, \.\.\.message \}, window\.location\.origin\)/);
  assert.doesNotMatch(pageRelay.slice(pageRelay.indexOf("toPage({")), /toPage\(\{[^}]*token/, "the pairing code is never posted back to the page");

  const linkedInWatcher = readFileSync("extensions/linkedin-bridge/linkedin-page.js", "utf8");
  assert.doesNotMatch(linkedInWatcher, /fetch\(|XMLHttpRequest|document\.cookie|innerText|textContent/, "the LinkedIn content script stays passive");
  // An orphaned copy (extension reloaded) must not throw "Extension context invalidated".
  assert.match(linkedInWatcher, /if \(!chrome\.runtime \|\| !chrome\.runtime\.id\) return stop\(\);\s*\n\s*try \{\s*\n\s*chrome\.runtime\.sendMessage/);

  const manifest = JSON.parse(readFileSync("extensions/linkedin-bridge/manifest.json", "utf8")) as Record<string, string[]>;
  assert.deepEqual(manifest.host_permissions, ["https://www.linkedin.com/*", "http://localhost/*", "http://127.0.0.1/*"]);
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
  const scripts = (manifest as unknown as { content_scripts: { matches: string[]; js: string[] }[] }).content_scripts;
  assert.deepEqual(
    scripts.map((c) => [c.js.join(), c.matches.join()]),
    [
      ["aria-page.js", "http://localhost/*,http://127.0.0.1/*"],
      ["linkedin-page.js", "https://www.linkedin.com/*"],
    ],
  );
});

test("a profile looked up before it is a candidate (prospect) owns nothing until adopted", () => {
  assert.equal(linkedInProfileUrl("jane-doe"), "https://www.linkedin.com/in/jane-doe");
  assert.equal(publicIdFromProfileUrl(linkedInProfileUrl("josé-garcía")), "josé-garcía");
  const server = readFileSync("src/lib/linkedin-bridge/server.ts", "utf8");
  assert.match(server, /export const PROSPECT_PREFIX = "prospect:"/);
  // Inbox sync and the profile answer never give a prospect a conversation.
  assert.match(server, /\.filter\(\(r\) => !isProspectId\(r\.candidate_id\)\)/);
  const result = readFileSync("src/app/api/linkedin/bridge/result/route.ts", "utf8");
  assert.match(result, /card\.memberId !== contact\.member_id && !isProspectId\(contact\.candidate_id\)/);
  const route = readFileSync("src/app/api/linkedin/candidates/route.ts", "utf8");
  // Preview: a LinkedIn profile URL only, a recent answer is reused (each look is a profile view).
  assert.match(route, /action: z\.literal\("preview"\), linkedinUrl/);
  assert.match(route, /Date\.now\(\) - Date\.parse\(known\.checked_at\) < 24 \* 60 \* 60 \* 1000/);
  // Adopt: the candidate is read from the workspace and must carry the same profile.
  assert.match(route, /const target = await candidateRecord\(svc, workspaceId, body\.candidateId\)/);
  assert.match(route, /publicIdFromProfileUrl\(target\.linkedinUrl\)\?\.toLowerCase\(\) !== prospect\.identity\.toLowerCase\(\)/);
  // Every action of the route, prospects included, is a same-origin write by a signed-in person.
  assert.match(route, /export async function POST\(req: NextRequest\) \{\n  const auth = await requireBridgeUser\(req, \{ mutation: true \}\);/);
});
