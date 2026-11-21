import { LinkedInTokenChannel, type Auditor, type MailMessage } from "./channel";

const messages: MailMessage[] = [];

const auditor: Auditor = {
  async postChatter(message) {
    messages.push(message);
  },
};

let channel: LinkedInTokenChannel | null = null;

export function getLinkedInTokenChannel(): LinkedInTokenChannel {
  if (!channel) {
    channel = new LinkedInTokenChannel({
      env: { lookup: (key) => process.env[key] },
      auditor,
      dbPath: process.env.ARIA_LINKEDIN_TOKEN_DB,
    });
  }
  return channel;
}

export function resetLinkedInTokenChannelForTests(): void {
  channel = null;
}
