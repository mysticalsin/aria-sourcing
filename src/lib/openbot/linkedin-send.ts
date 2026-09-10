/**
 * LinkedIn message / connection send driven through an OpenBot agent-computer.
 * Heuristic element picking first; optional Aria LLM assist for ambiguous UIs.
 * Humanizer always runs last-mile before any text is typed into LinkedIn.
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
import { humanizeText } from "@/lib/humanizer";

export type OpenBotLinkedInSendInput = {
  profileUrl: string;
  messageBody: string;
  subject?: string;
  /** Prefer Connect + note when Message is unavailable (1st-degree gate). */
  preferConnect?: boolean;
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
): Promise<OpenBotSnapshotElement | undefined> {
  if (heuristic) return heuristic;
  return pickOpenBotElementWithAriaLlm(elements, goal);
}

/**
 * Navigate to a LinkedIn profile and either Message or Connect+note.
 * Humanizer always runs before any text is typed.
 */
export async function openBotLinkedInSend(
  cfg: OpenBotAgentComputerConfig,
  input: OpenBotLinkedInSendInput,
): Promise<OpenBotLinkedInSendResult> {
  const profileUrl = input.profileUrl.trim();
  const body = humanizeText(input.messageBody).trim();
  const subject = input.subject ? humanizeText(input.subject).trim() : "";
  if (!profileUrl) return { ok: false, detail: "profileUrl is required" };
  if (!body) return { ok: false, detail: "message body is required" };

  const nav = await openBotNavigate(cfg, profileUrl);
  if (looksLikeLoginWall(nav.text ?? "", nav.title, nav.url)) {
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

  const composed = subject ? `${subject}\n\n${body}` : body;
  const preferConnect = input.preferConnect === true;

  async function sendDirectMessage(): Promise<OpenBotLinkedInSendResult | null> {
    const messageBtn = await resolveRef(
      snap.elements,
      pickMessageButton(snap.elements),
      "Click the control that opens a LinkedIn direct message composer on this profile.",
    );
    if (!messageBtn) return null;

    await openBotClick(cfg, messageBtn.ref, snap.snapshotId);
    snap = await openBotSnapshot(cfg);

    const box = await resolveRef(
      snap.elements,
      pickMessageBox(snap.elements),
      "Select the LinkedIn message text box where the outreach body should be typed.",
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
    );
    if (!sendBtn) {
      return {
        ok: false,
        detail: "Typed message but could not find Send — operator takeover required.",
        helpRequested: true,
      };
    }
    await openBotClick(cfg, sendBtn.ref, snap.snapshotId);
    return {
      ok: true,
      detail: `OpenBot browser-computer send via ${normalize(sendBtn.name) || "Send"} on ${profileUrl}`,
    };
  }

  async function sendConnectWithNote(): Promise<OpenBotLinkedInSendResult | null> {
    const connectBtn = await resolveRef(
      snap.elements,
      pickConnectButton(snap.elements),
      "Click Connect on this LinkedIn profile to send a connection invitation.",
    );
    if (!connectBtn) return null;

    await openBotClick(cfg, connectBtn.ref, snap.snapshotId);
    snap = await openBotSnapshot(cfg);

    const addNote = await resolveRef(
      snap.elements,
      pickAddNoteButton(snap.elements),
      "Click Add a note so the connection invite can include a personalized message.",
    );
    if (addNote) {
      await openBotClick(cfg, addNote.ref, snap.snapshotId);
      snap = await openBotSnapshot(cfg);
    }

    const noteBox = await resolveRef(
      snap.elements,
      pickInviteNoteBox(snap.elements),
      "Select the invitation note text box for the LinkedIn connection request.",
    );
    if (!noteBox) {
      return {
        ok: false,
        detail: "Connect dialog opened but no note field found — operator takeover required.",
        helpRequested: true,
      };
    }

    const note = body.length > 280 ? `${body.slice(0, 277)}...` : body;
    await openBotType(cfg, noteBox.ref, snap.snapshotId, note, false);
    snap = await openBotSnapshot(cfg);

    const sendInvite = await resolveRef(
      snap.elements,
      pickSendInviteButton(snap.elements),
      "Click Send / Send invitation to submit the LinkedIn connection request.",
    );
    if (!sendInvite) {
      return {
        ok: false,
        detail: "Typed connect note but could not find Send invitation — operator takeover required.",
        helpRequested: true,
      };
    }
    await openBotClick(cfg, sendInvite.ref, snap.snapshotId);
    return {
      ok: true,
      detail: `OpenBot browser-computer connection invite via ${normalize(sendInvite.name) || "Send"} on ${profileUrl}`,
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

  return {
    ok: false,
    detail:
      "Could not find Message or Connect on the profile — take control in Fleet and finish login or open the composer once.",
    helpRequested: true,
  };
}
