import { isRealSendFact } from "../metrics";
import { deriveLeadSource } from "../tania";
import type { Booking, Campaign, Candidate, HermesState, WinRecord } from "../types";
import { genId } from "../utils";

export const WIN_RECORD_LIMIT = 500;

export function deriveWinRecord(
  state: HermesState,
  candidate: Candidate,
  campaign: Campaign,
  booking: Booking,
): WinRecord {
  try {
    const outreachById = new Map(state.outreach.map((message) => [message.id, message]));
    const joined = candidate.outreachHistory
      .map((entry) => {
        const message = outreachById.get(entry.messageId);
        return message ? { entry, message } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const realSends = joined
      .filter(({ message }) => isRealSendFact(message))
      .sort((a, b) => {
        const aAt = new Date(a.message.sentAt ?? a.entry.at).getTime();
        const bAt = new Date(b.message.sentAt ?? b.entry.at).getTime();
        return aAt - bAt;
      });
    const earliestRealSend = realSends[0] ?? null;
    const winningSend = realSends[realSends.length - 1] ?? null;
    const newestReply =
      state.replies
        .filter((reply) => reply.candidateId === candidate.id)
        .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())[0] ?? null;
    const bookingAt = new Date(booking.createdAt).getTime();
    const firstSendAt = earliestRealSend
      ? new Date(earliestRealSend.message.sentAt ?? earliestRealSend.entry.at).getTime()
      : Number.NaN;

    return {
      id: genId("win"),
      at: booking.createdAt,
      candidateId: candidate.id,
      candidateName: candidate.name,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      bookingId: booking.id,
      sourcePlatform: candidate.sourcePlatform,
      leadSource: candidate.leadSource ?? deriveLeadSource(candidate),
      matchScore: candidate.matchScore,
      seniority: campaign.jobAnalysis.seniority,
      roleTitle: campaign.jobAnalysis.title,
      outreachChannel: winningSend?.message.channel ?? null,
      touchCount: realSends.length,
      timeToBookMs:
        Number.isFinite(bookingAt) && Number.isFinite(firstSendAt)
          ? Math.max(0, bookingAt - firstSendAt)
          : null,
      triggeringReplyIntent: newestReply
        ? { intent: newestReply.intent, confidence: newestReply.confidence }
        : null,
      messageTraits: winningSend
        ? {
            subjectLength: winningSend.message.subject.length,
            bodyLength: winningSend.message.body.length,
            tone: winningSend.message.tone,
          }
        : {},
    };
  } catch {
    return {
      id: genId("win"),
      at: booking.createdAt,
      candidateId: candidate.id,
      candidateName: candidate.name,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      bookingId: booking.id,
      sourcePlatform: candidate.sourcePlatform,
      leadSource: candidate.leadSource ?? null,
      matchScore: candidate.matchScore,
      seniority: campaign.jobAnalysis.seniority,
      roleTitle: campaign.jobAnalysis.title,
      outreachChannel: candidate.outreachHistory[0]?.channel ?? null,
      touchCount: 0,
      timeToBookMs: null,
      triggeringReplyIntent: candidate.replyHistory[0]
        ? {
            intent: candidate.replyHistory[0].intent,
            confidence: candidate.replyHistory[0].confidence,
          }
        : null,
      messageTraits: {},
    };
  }
}

export function appendWinRecord(
  state: HermesState,
  candidate: Candidate,
  campaign: Campaign,
  booking: Booking,
): HermesState {
  const win = deriveWinRecord(state, candidate, campaign, booking);
  return { ...state, wins: [win, ...(state.wins ?? [])].slice(0, WIN_RECORD_LIMIT) };
}
