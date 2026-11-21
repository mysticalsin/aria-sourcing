/**
 * One approval click for the draft card and the glass box.
 * An edit is written first, so the approval binds the text on screen.
 * This function does not deliver a LinkedIn message.
 */

export interface DisplayedApprovalResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  dryRun?: boolean;
}

export async function approveDisplayedOutreach(input: {
  messageId: string;
  displayedSubject: string;
  displayedBody: string;
  savedSubject: string;
  savedBody: string;
  updateDraft: (patch: { subject: string; body: string }) => void;
  approve: (messageId: string) => Promise<DisplayedApprovalResult>;
}): Promise<{ result: DisplayedApprovalResult; voided: boolean }> {
  const voided =
    input.displayedSubject !== input.savedSubject || input.displayedBody !== input.savedBody;
  if (voided) {
    input.updateDraft({ subject: input.displayedSubject, body: input.displayedBody });
  }
  const result = await input.approve(input.messageId);
  return { result, voided };
}