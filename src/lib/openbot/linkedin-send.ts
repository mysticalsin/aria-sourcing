/**
 * LinkedIn message / connection send driven through an OpenBot agent-computer.
 * Heuristic element picking first; optional Aria LLM assist for ambiguous UIs.
 * Types recruiter-approved Outreach copy verbatim — never re-humanize after seal.
 */

import {
  openBotClick,
  openBotNavigate,
  openBotSnapshot,
  openBotType,
  type OpenBotAgentComputerConfig,
  type OpenBotSnapshotElement,
} from "@/lib/openbot/agent-computer-client";
import { pickOpenBotElementWithAriaLlm } from "@/lib/openbot/llm-pick-element";
import { LINKEDIN_INVITE_NOTE_MAX } from "@/lib/linkedin-invite-note";
import {
  appendLinkedInUiLesson,
  linkedInUiLessonHints,
  preferConnectFromLessons,
} from "@/lib/openbot/linkedin-ui-lessons";

export type OpenBotLinkedInSendInput = {
  profileUrl: string;
  /** Exact recruiter-approved body — typed verbatim; never re-humanized here. */
  messageBody: string;
  subject?: string;
  /** Prefer Connect + note when Message is unavailable (1st-degree gate). */
  preferConnect?: boolean;
  /** Optional seat/campaign scope for per-desk UI lessons (N-agent isolation). */
  seatId?: string | null;
  campaignId?: string | null;
};

export type OpenBotLinkedInSendResult = {
  ok: boolean;
  detail: string;
  helpRequested?: boolean;
};

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function findByName(
  elements: OpenBotSnapshotElement[],
  predicates: Array<(el: OpenBotSnapshotElement) => boolean>,
): OpenBotSnapshotElement | undefined {
  for (const pred of predicates) {
    const hit = elements.find((el) => !el.disabled && pred(el));
    if (hit) return hit;
  }
  return undefined;
}

function pickMessageButton(elements: OpenBotSnapshotElement[]): OpenBotSnapshotElement | undefined {
  return findByName(elements, [
    (el) => el.role === "button" && /^(message|messaging)$/i.test(el.name.trim()),
    (el) => el.role === "link" && /^(message|messaging)$/i.test(el.name.trim()),
    (el) => (el.role === "button" || el.role === "link") && /\bmessage\b/i.test(el.name),
    (el) => (el.role === "button" || el.role === "link") && /\binmail\b/i.test(el.name),
  ]);
}

function pickMessageBox(elements: OpenBotSnapshotElement[]): OpenBotSnapshotElement | undefined {
  return findByName(elements, [
    (el) =>
      (el.role === "textbox" || el.role === "searchbox") &&
      /message|write a message|type a message|add a message/i.test(el.name),
    (el) => el.role === "textbox" && !/search|filter|note on your invitation/i.test(el.name),
  ]);
}

function pickSendButton(elements: OpenBotSnapshotElement[]): OpenBotSnapshotElement | undefined {
  return findByName(elements, [
    (el) => el.role === "button" && /^(send|send message)$/i.test(el.name.trim()),
    (el) => el.role === "button" && /\bsend\b/i.test(el.name) && !/invite|connection/i.test(el.name),
  ]);
}

function pickConnectButton(elements: OpenBotSnapshotElement[]): OpenBotSnapshotElement | undefined {
  return findByName(elements, [
    (el) => el.role === "button" && /^connect$/i.test(el.name.trim()),
    (el) => (el.role === "button" || el.role === "link") && /^connect$/i.test(el.name.trim()),
    (el) =>
      (el.role === "button" || el.role === "link") &&
      /\bconnect\b/i.test(el.name) &&
      !/remove|disconnect/i.test(el.name),
  ]);
}

function pickInviteNoteBox(elements: OpenBotSnapshotElement[]): OpenBotSnapshotElement | undefined {
  return findByName(elements, [
    (el) =>
      (el.role === "textbox" || el.role === "searchbox") &&
      /note|invitation|personal|message/i.test(el.name),
    (el) => el.role === "textbox",
  ]);
}

function pickSendInviteButton(elements: OpenBotSnapshotElement[]): OpenBotSnapshotElement | undefined {
  return findByName(elements, [
    (el) => el.role === "button" && /^(send|send invitation|send invite|done)$/i.test(el.name.trim()),
    (el) => el.role === "button" && /\bsend\b/i.test(el.name),
  ]);
}

function pickAddNoteButton(elements: OpenBotSnapshotElement[]): OpenBotSnapshotElement | undefined {
  return findByName(elements, [
    (el) => el.role === "button" && /add a note|include a note|personalize/i.test(el.name),
  ]);
}

function looksLikeLoginWall(text: string, title: string, url: string): boolean {
  const blob = `${url} ${title} ${text}`.toLowerCase();
  return (
    blob.includes("/login") ||
    blob.includes("sign in") ||
    blob.includes("authwall") ||
    blob.includes("checkpoint") ||
    blob.includes("enter the code") ||
    blob.includes("two-step") ||
    blob.includes("2fa")
  );
}

async function resolveRef(
  elements: OpenBotSnapshotElement[],
  heuristic: OpenBotSnapshotElement | undefined,
  goal: string,
  lessonGoal?: Parameters<typeof linkedInUiLessonHints>[0],
): Promise<OpenBotSnapshotElement | undefined> {
  if (heuristic) {
    if (lessonGoal && heuristic.name) {
      // Soft prefer: heuristic already matched; remember name on success path later.
    }
    return heuristic;
  }
  const enriched = lessonGoal ? `${goal}${linkedInUiLessonHints(lessonGoal)}` : goal;
  return pickOpenBotElementWithAriaLlm(elements, enriched);
}

/**
 * Navigate to a LinkedIn profile and either Message or Connect+note.
 * Types the recruiter-approved body verbatim — humanizer/gate run at approve,
 * not here, so bots cannot silently rewrite sealed copy.
 */
export async function openBotLinkedInSend(
  cfg: OpenBotAgentComputerConfig,
  input: OpenBotLinkedInSendInput,
): Promise<OpenBotLinkedInSendResult> {
  const profileUrl = input.profileUrl.trim();
  // Exact sealed copy from Outreach approve — never re-humanize on the wire.
  const body = (input.messageBody ?? "").trim();
  const subject = (input.subject ?? "").trim();
  if (!profileUrl) return { ok: false, detail: "profileUrl is required" };
  if (!body) return { ok: false, detail: "message body is required" };

  const nav = await openBotNavigate(cfg, profileUrl);
  if (looksLikeLoginWall(nav.text ?? "", nav.title, nav.url)) {
    appendLinkedInUiLesson({
      goal: "login_wall",
      ok: false,
      detail: "Hit LinkedIn login/2FA wall — need Take control",
      seatId: input.seatId,
      campaignId: input.campaignId,
    });
    return {
      ok: false,
      detail: "LinkedIn login/2FA wall — open Fleet → Computers → Observe / Take control",
      helpRequested: true,
    };
  }

  let snap = await openBotSnapshot(cfg);
  if (looksLikeLoginWall("", snap.title, snap.url)) {
    return {
      ok: false,
      detail: "LinkedIn login/2FA wall — open Fleet → Computers → Observe / Take control",
      helpRequested: true,
    };
  }

  // Free LinkedIn Messaging is body-only. Dumping Subject\\n\\nBody into the DM
  // box is a common robotic failure mode (and wastes invite-note budget on Connect).
  const composed = body;
  const lessonPrefer = preferConnectFromLessons();
  const preferConnect =
    input.preferConnect === true || (input.preferConnect !== false && lessonPrefer === true);
  void subject; // subject reserved for InMail-capable seats; not typed into free DM.

  async function sendDirectMessage(): Promise<OpenBotLinkedInSendResult | null> {
    const messageBtn = await resolveRef(
      snap.elements,
      pickMessageButton(snap.elements),
      "Click the control that opens a LinkedIn direct message composer on this profile.",
      "message",
    );
    if (!messageBtn) return null;

    await openBotClick(cfg, messageBtn.ref, snap.snapshotId);
    snap = await openBotSnapshot(cfg);

    const box = await resolveRef(
      snap.elements,
      pickMessageBox(snap.elements),
      "Select the LinkedIn message text box where the outreach body should be typed.",
      "message_box",
    );
    if (!box) {
      return {
        ok: false,
        detail: "Message composer did not open or no text box found — operator takeover required.",
        helpRequested: true,
      };
    }

    await openBotType(cfg, box.ref, snap.snapshotId, composed, false);
    snap = await openBotSnapshot(cfg);
    const sendBtn = await resolveRef(
      snap.elements,
      pickSendButton(snap.elements),
      "Click the control that sends the LinkedIn message (Send).",
      "send",
    );
    if (!sendBtn) {
      return {
        ok: false,
        detail: "Typed message but could not find Send — operator takeover required.",
        helpRequested: true,
      };
    }
    if (sendBtn.disabled) {
      return {
        ok: false,
        detail: "Send is disabled (InMail/gate) — not claiming LinkedIn message delivery.",
        helpRequested: true,
      };
    }
    await openBotClick(cfg, sendBtn.ref, snap.snapshotId);
    // Fail closed: a bare Send click is not proof the message left LinkedIn.
    snap = await openBotSnapshot(cfg);
    const proof = snap.elements.some((el) =>
      /message sent|sent successfully|your message was sent|delivered/i.test(el.name),
    );
    if (!proof) {
      return {
        ok: false,
        detail: "Clicked Send but no Message-sent proof in UI — operator must confirm delivery.",
        helpRequested: true,
      };
    }
    appendLinkedInUiLesson({
      goal: "path",
      ok: true,
      detail: "Message path landed with sent proof",
      preferredName: sendBtn.name,
      seatId: input.seatId,
      campaignId: input.campaignId,
    });
    appendLinkedInUiLesson({
      goal: "send",
      ok: true,
      detail: "Send control confirmed delivery proof",
      preferredName: sendBtn.name,
      seatId: input.seatId,
      campaignId: input.campaignId,
    });
    return {
      ok: true,
      detail: `OpenBot browser-computer send via ${normalize(sendBtn.name) || "Send"} on ${profileUrl} (sent proof confirmed)`,
    };
  }

  async function sendConnectWithNote(): Promise<OpenBotLinkedInSendResult | null> {
    const connectBtn = await resolveRef(
      snap.elements,
      pickConnectButton(snap.elements),
      "Click Connect on this LinkedIn profile to send a connection invitation.",
      "connect",
    );
    if (!connectBtn) return null;

    await openBotClick(cfg, connectBtn.ref, snap.snapshotId);
    snap = await openBotSnapshot(cfg);

    const addNote = await resolveRef(
      snap.elements,
      pickAddNoteButton(snap.elements),
      "Click Add a note so the connection invite can include a personalized message.",
      "add_note",
    );
    if (addNote) {
      await openBotClick(cfg, addNote.ref, snap.snapshotId);
      snap = await openBotSnapshot(cfg);
    }

    const noteBox = await resolveRef(
      snap.elements,
      pickInviteNoteBox(snap.elements),
      "Select the invitation note text box for the LinkedIn connection request.",
      "invite_note",
    );
    if (!noteBox) {
      return {
        ok: false,
        detail: "Connect dialog opened but no note field found — operator takeover required.",
        helpRequested: true,
      };
    }

    // Sealed approve copy must already be ≤200. Never soft-truncate here — that
    // would send different text than the recruiter validated.
    if (body.length > LINKEDIN_INVITE_NOTE_MAX) {
      return {
        ok: false,
        detail: `Connect note is ${body.length} chars (max ${LINKEDIN_INVITE_NOTE_MAX}). Re-approve a short note in Outreach — refusing to rewrite sealed copy at send.`,
        helpRequested: false,
      };
    }
    const note = body;
    await openBotType(cfg, noteBox.ref, snap.snapshotId, note, false);
    snap = await openBotSnapshot(cfg);

    const sendInvite = await resolveRef(
      snap.elements,
      pickSendInviteButton(snap.elements),
      "Click Send / Send invitation to submit the LinkedIn connection request.",
      "send_invite",
    );
    if (!sendInvite) {
      return {
        ok: false,
        detail: "Typed connect note but could not find Send invitation — operator takeover required.",
        helpRequested: true,
      };
    }
    if (sendInvite.disabled) {
      return {
        ok: false,
        detail: `Send invitation is disabled (note ${note.length}/${LINKEDIN_INVITE_NOTE_MAX} chars or LinkedIn gate) — not claiming delivery.`,
        helpRequested: true,
      };
    }
    await openBotClick(cfg, sendInvite.ref, snap.snapshotId);
    // Fail closed unless the UI shows Sent/Pending — a bare click is not a notification.
    snap = await openBotSnapshot(cfg);
    const proof = snap.elements.some((el) =>
      /pending|invitation sent|invite sent|sent$/i.test(el.name),
    );
    if (!proof) {
      return {
        ok: false,
        detail: "Clicked Send invitation but no Sent/Pending proof in UI — operator must confirm delivery.",
        helpRequested: true,
      };
    }
    appendLinkedInUiLesson({
      goal: "path",
      ok: true,
      detail: "Connect+note path landed with Sent/Pending proof",
      preferredName: connectBtn.name,
      seatId: input.seatId,
      campaignId: input.campaignId,
    });
    appendLinkedInUiLesson({
      goal: "send_invite",
      ok: true,
      detail: "Send invitation confirmed Sent/Pending",
      preferredName: sendInvite.name,
      seatId: input.seatId,
      campaignId: input.campaignId,
    });
    return {
      ok: true,
      detail: `OpenBot browser-computer connection invite via ${normalize(sendInvite.name) || "Send"} on ${profileUrl} (Sent/Pending confirmed)`,
    };
  }

  if (preferConnect) {
    const connected = await sendConnectWithNote();
    if (connected) return connected;
    const messaged = await sendDirectMessage();
    if (messaged) return messaged;
  } else {
    const messaged = await sendDirectMessage();
    if (messaged) return messaged;
    const connected = await sendConnectWithNote();
    if (connected) return connected;
  }

  appendLinkedInUiLesson({
    goal: "path",
    ok: false,
    detail: "Neither Message nor Connect found — Take control to finish login/composer",
    seatId: input.seatId,
    campaignId: input.campaignId,
  });
  return {
    ok: false,
    detail:
      "Could not find Message or Connect on the profile — take control in Fleet and finish login or open the composer once.",
    helpRequested: true,
  };
}
