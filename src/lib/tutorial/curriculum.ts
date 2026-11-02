import { recordedCandidateLawfulBasis } from "@/lib/candidate-lawful-basis";
import type { HermesState } from "@/lib/types";

/* ============================================================================
   Tutorial curriculum — the step-by-step walkthrough opened from the menu.
   Pure data plus small helpers, so the copy, the routes and the completion
   checks can be tested without a browser. The panel that renders it lives in
   src/components/tutorial/tutorial.tsx.
   ========================================================================== */

/** What the tutorial watches to notice that the learner did the exercise. */
export interface TutorialCounts {
  campaigns: number;
  outreach: number;
  approved: number;
  followUps: number;
  replyDrafts: number;
  talentPool: number;
  contactBasis: number;
}

export function tutorialCounts(
  state: Pick<HermesState, "campaigns" | "outreach" | "candidates">,
): TutorialCounts {
  return {
    campaigns: state.campaigns.length,
    outreach: state.outreach.length,
    approved: state.outreach.filter((m) => m.status === "Approved" || m.status === "Scheduled" || m.status === "Pending Manual Send")
      .length,
    followUps: state.outreach.filter((m) => m.sequenceStep > 1).length,
    replyDrafts: state.outreach.filter((m) => Boolean(m.inReplyTo)).length,
    talentPool: state.candidates.filter((c) => c.vivier).length,
    contactBasis: state.candidates.filter((c) => recordedCandidateLawfulBasis(c) !== null).length,
  };
}

export interface TutorialStep {
  id: string;
  title: string;
  /** What this part is for, in two or three plain sentences. */
  body: string;
  /** The exercise. Names the exact button labels the learner will see. */
  tryIt?: string;
  /** Where the step happens; the panel offers to go there. */
  route: string;
  /** Short page name for "This step is on …". */
  page: string;
  /** Other pages the exercise naturally leads to (e.g. a profile opened from
   *  the step page); being there does not count as having left the step. */
  alsoOn?: string[];
  /** CSS selectors of the area to highlight; the first visible one wins. */
  target?: string[];
  /** True once the learner has done the exercise, compared with the counts
   *  taken when the step opened. */
  done?: (now: TutorialCounts, start: TutorialCounts) => boolean;
  /** Shown once `done` is true. */
  doneText?: string;
  /** An extra link, e.g. a public page opened in a new tab. */
  action?: { label: string; href: string };
}

export interface TutorialChapter {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  steps: TutorialStep[];
}

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: "basics",
    title: "Find your way around",
    summary: "What Aria does, how the menu is organised, and why nothing is sent without you.",
    minutes: 2,
    steps: [
      {
        id: "basics-welcome",
        title: "Welcome to Aria",
        body:
          "Aria takes a recruiter from a job brief to booked interviews. It finds people, drafts messages and books calls, and you approve every step. This tutorial shows each part and gives you something small to try.",
        tryIt:
          "Look at the menu. Pages are grouped by what you do: Recruit, Engage, Analyze and System. On a phone, open it with the ☰ button.",
        route: "/",
        page: "Home",
        target: ['nav[aria-label="Primary"]', 'nav[aria-label="Primary mobile"]'],
      },
      {
        id: "basics-mode",
        title: "Nothing leaves without you",
        body:
          "This chip shows the mode you are in. In the demo the people are fictional and dry-run is on: messages are drafted and approved, but never really sent. With a real workspace it reads Live.",
        tryIt: "Hover the chip (or tap it) to read the details.",
        route: "/",
        page: "Home",
        target: ['[data-tour="mode-chip"]'],
      },
      {
        id: "basics-home",
        title: "Home shows your next move",
        body:
          "The large card always holds the single most useful thing to do now, such as drafts waiting for your approval. The figures below say exactly what they count, for example real sends versus simulated ones.",
        tryIt: "Read the next action on the card. You will do it later in this tutorial.",
        route: "/",
        page: "Home",
        target: ['[data-tour="home-hero"]'],
      },
    ],
  },
  {
    id: "campaign",
    title: "Create a campaign",
    summary: "Turn a hiring manager's email into a structured brief, for one role or several.",
    minutes: 4,
    steps: [
      {
        id: "campaign-type",
        title: "One role or several",
        body:
          "A campaign is one role you are hiring for. Start from a hiring manager's email for a single role, or from a brief that lists several roles: Aria then creates one campaign per role.",
        tryIt: "Notice the two options at the top: One role and Several roles.",
        route: "/campaigns/new",
        page: "New campaign",
        target: ['nav[aria-label="Campaign type"]'],
      },
      {
        id: "campaign-parse",
        title: "Turn an email into a brief",
        body:
          "Aria reads the request and fills in a brief: title, seniority, skills, location and salary. Each field shows how sure it is, and anything missing is flagged so you can ask the manager.",
        tryIt: "Click “Sample backend role”, then “Parse JD”. The brief appears on the right.",
        route: "/campaigns/new",
        page: "New campaign",
        target: ['[data-tour="intake-brief"]'],
      },
      {
        id: "campaign-create",
        title: "Check it, then create",
        body:
          "Everything in the brief can be edited. Validation warnings point at gaps, and a suggested reply asks the hiring manager for what is missing.",
        tryIt: "Change anything you disagree with, then click “Create campaign” at the bottom of the brief.",
        route: "/campaigns/new",
        page: "New campaign",
        target: ['[data-tour="create-campaign"]', '[data-tour="intake-brief"]'],
        done: (now, start) => now.campaigns > start.campaigns,
        doneText: "Campaign created. You will find it under Campaigns.",
      },
      {
        id: "campaign-several",
        title: "Several roles at once",
        body:
          "When a client sends one brief for several roles, paste it whole. Aria splits it, creates one campaign per role and starts sourcing them side by side.",
        tryIt: "Click “Load sample brief (6 roles)”, then “Launch”. One lane per role fills up below.",
        route: "/campaigns/new?roles=several",
        page: "New campaign · Several roles",
        target: ['[data-tour="launch-brief"]'],
        done: (now, start) => now.campaigns >= start.campaigns + 2,
        doneText: "Campaigns launched, one per role.",
      },
    ],
  },
  {
    id: "find",
    title: "Find candidates",
    summary: "Let Aria source and score people, then explore them by list, profile and stage.",
    minutes: 5,
    steps: [
      {
        id: "find-run",
        title: "Let Aria source and draft",
        body:
          "On a campaign, Run Aria starts a small team of agents. One searches and scores candidates; others write a first message for the best matches. Nothing is sent: every draft waits for your approval.",
        tryIt: "Click “Run Aria” and watch the stream. Each draft says whether Claude wrote it or a template did.",
        route: "/campaigns/camp_seed_design",
        page: "Campaign: Senior Product Designer",
        target: ['[data-tour="run-aria"]'],
        done: (now, start) => now.outreach > start.outreach,
        doneText: "Drafts are ready. You will approve them in the Engage chapter.",
      },
      {
        id: "find-list",
        title: "Every candidate in one list",
        body:
          "Candidates from all campaigns, ranked by match score out of 100. The source pill shows where each person was found and whether you may contact them.",
        tryIt: "Pick a stage in the Stage filter, then set it back to All stages.",
        route: "/candidates",
        page: "Candidates",
        target: ['[data-tour="candidate-toolbar"]'],
      },
      {
        id: "find-profile",
        title: "Open a profile",
        body:
          "A profile explains the score: each criterion with its weight, why this person was picked, the source, and every message exchanged. Strong people you do not hire now can join the talent pool.",
        tryIt: "Click a candidate. In the panel, read “Why this person”, then click “Add to talent pool”.",
        route: "/candidates",
        page: "Candidates",
        target: ['[data-tour="candidate-list"]'],
        done: (now, start) => now.talentPool > start.talentPool,
        doneText: "Added. You will find this person in the Talent pool tab.",
      },
      {
        id: "find-views",
        title: "Applicants and the talent pool",
        body:
          "Two more views of people. Applicants applied themselves through the careers page chat, each with a score. The talent pool keeps strong people you did not hire this time, with a date to get back in touch.",
        tryIt: "Open the Applicants tab, then the Talent pool tab.",
        route: "/candidates",
        page: "Candidates",
        target: ['nav[aria-label="Views"]'],
      },
      {
        id: "find-pipeline",
        title: "The hiring pipeline",
        body:
          "Each column is a hiring stage, from applications to people who started. Cards show the score and the source, so you see where the pipeline is thin.",
        tryIt: "Drag a card to the next column. Moving someone forward is always your decision.",
        route: "/funnel",
        page: "Pipeline",
        target: ['[data-tour="pipeline-board"]'],
      },
    ],
  },
  {
    id: "engage",
    title: "Talk to candidates",
    summary: "Approve drafts, send follow-ups, sort replies and book interviews.",
    minutes: 5,
    steps: [
      {
        id: "engage-basis",
        title: "Record why you may contact someone",
        body:
          "Before a first message, you record the lawful basis for contacting this person (consent or legitimate interest) and your evidence. Aria never decides it for you: until it is recorded, approval stays blocked.",
        tryIt:
          "Open a draft below and click “View candidate”. Under Consent passport, pick a Contact basis, write your evidence (for example “Public GitHub profile, relevant work”), then click “Record contact basis”.",
        route: "/outreach",
        page: "Outreach",
        alsoOn: ["/candidates"],
        target: ['[data-tour="approval-queue"]'],
        done: (now, start) => now.contactBasis > start.contactBasis,
        doneText: "Basis recorded. Next, approve this person's draft.",
      },
      {
        id: "engage-approve",
        title: "Approve before anything sends",
        body:
          "Every draft lands here. Open one to read it, see why this person was chosen and what the guardrails checked. You can edit, approve or reject it.",
        tryIt: "Back in Outreach, open the draft for the person whose basis you recorded and click “Approve”.",
        route: "/outreach",
        page: "Outreach",
        target: ['[data-tour="approval-queue"]'],
        done: (now, start) => now.approved > start.approved,
        doneText: "Approved. In the demo it is queued, never actually sent.",
      },
      {
        id: "engage-follow-ups",
        title: "Follow-ups in one click",
        body:
          "When someone has not answered, a follow-up becomes due. Aria drafts them all at once, best matches first, and they join the same approval queue.",
        tryIt: "Click “Draft all due follow-ups”.",
        route: "/outreach",
        page: "Outreach",
        target: ['[data-tour="draft-due"]'],
        done: (now, start) => now.followUps > start.followUps,
        doneText: "Follow-ups drafted and waiting in the queue.",
      },
      {
        id: "engage-replies",
        title: "Sort the replies",
        body:
          "Aria reads each reply, labels its intent (interested, not now, referral…) and drafts an answer for the ones worth answering. You check each answer before it goes.",
        tryIt: "Click “Triage inbox”.",
        route: "/replies",
        page: "Replies",
        target: ['[data-tour="triage-inbox"]'],
        done: (now, start) => now.replyDrafts > start.replyDrafts,
        doneText: "Answers drafted for the replies that need one.",
      },
      {
        id: "engage-calendar",
        title: "Book the interview",
        body:
          "Interviews appear here with the interviewer and the time. You book them from a candidate's profile with “Book interview”, and the candidate moves forward in the pipeline.",
        tryIt: "Look through this week's interviews.",
        route: "/calendar",
        page: "Calendar",
        target: ['[data-tour="calendar"]'],
      },
    ],
  },
  {
    id: "control",
    title: "Measure and stay in control",
    summary: "Read the reports, set the rules, see the AI cost and the candidate's side.",
    minutes: 4,
    steps: [
      {
        id: "control-reports",
        title: "Reports",
        body:
          "Overview sums up the funnel and the recruiter time saved. Learning loop, Wins and Trust & ROI show what worked, and what it is worth.",
        tryIt: "Open each of the four tabs.",
        route: "/exec",
        page: "Reports",
        target: ['nav[aria-label="Views"]'],
      },
      {
        id: "control-rules",
        title: "You set the rules",
        body:
          "Settings decide how much Aria may do alone: dry-run, approval before every send, daily limits and quiet hours. The defaults keep a person in charge.",
        tryIt: "Read the approval settings. There is no need to change them.",
        route: "/settings#settings-section-02",
        page: "Settings · Approval",
        target: ["#settings-section-02"],
      },
      {
        id: "control-ai",
        title: "Which AI does what",
        body:
          "Each task uses a suitable Claude model: Haiku to classify replies and read briefs, Sonnet to write. The usage card shows this month's cost against the budget.",
        tryIt: "Find the “Claude usage” card under the saved models.",
        route: "/settings#settings-section-15",
        page: "Settings · AI & Models",
        target: ["#settings-section-15"],
      },
      {
        id: "control-costs",
        title: "What the AI costs",
        body:
          "AI costs splits Claude's spend by activity: which one costs most, what one result costs, and why it runs on that model. It is the page to open when someone asks what the AI is worth.",
        tryIt: "Find the most expensive activity, then read its line in “What each activity buys”.",
        route: "/costs",
        page: "AI costs",
        target: ['[data-tour="cost-activities"]', '[data-tour="cost-kpis"]'],
      },
      {
        id: "control-careers",
        title: "What candidates see",
        body:
          "The public careers page lets people apply through a short chat. Their application lands in Applicants with a score. In the demo the roles are examples and nothing is stored.",
        tryIt: "Open the careers page in a new tab and apply to a role.",
        route: "/",
        page: "Home",
        action: { label: "Open the careers page", href: "/careers" },
      },
      {
        id: "control-done",
        title: "You have seen all of Aria",
        body:
          "Reopen the tutorial from the menu whenever you like; your progress is kept. To start again with fresh demo data, use “Reset synthetic demo” in your profile menu.",
        route: "/",
        page: "Home",
      },
    ],
  },
];

export interface TutorialPosition {
  chapter: number;
  step: number;
}

export function stepAt(pos: TutorialPosition): TutorialStep | undefined {
  return TUTORIAL_CHAPTERS[pos.chapter]?.steps[pos.step];
}

export function nextPosition(pos: TutorialPosition): TutorialPosition | null {
  const chapter = TUTORIAL_CHAPTERS[pos.chapter];
  if (!chapter) return null;
  if (pos.step + 1 < chapter.steps.length) return { chapter: pos.chapter, step: pos.step + 1 };
  if (pos.chapter + 1 < TUTORIAL_CHAPTERS.length) return { chapter: pos.chapter + 1, step: 0 };
  return null;
}

export function previousPosition(pos: TutorialPosition): TutorialPosition | null {
  if (pos.step > 0) return { chapter: pos.chapter, step: pos.step - 1 };
  if (pos.chapter > 0) {
    const previous = TUTORIAL_CHAPTERS[pos.chapter - 1];
    return { chapter: pos.chapter - 1, step: previous.steps.length - 1 };
  }
  return null;
}

/** Steps finished in a chapter, out of its total. */
export function chapterProgress(chapterIndex: number, completed: ReadonlySet<string>): { done: number; total: number } {
  const steps = TUTORIAL_CHAPTERS[chapterIndex]?.steps ?? [];
  return { done: steps.filter((s) => completed.has(s.id)).length, total: steps.length };
}

/** Where "Continue" should land: the first unfinished step, in order. */
export function resumePosition(completed: ReadonlySet<string>): TutorialPosition | null {
  for (let chapter = 0; chapter < TUTORIAL_CHAPTERS.length; chapter += 1) {
    const step = TUTORIAL_CHAPTERS[chapter].steps.findIndex((s) => !completed.has(s.id));
    if (step >= 0) return { chapter, step };
  }
  return null;
}

/** Path and query of a step route, without the hash (the panel compares it
 *  with the current location to offer "Take me there"). */
export function routeLocation(route: string): { pathname: string; search: string } {
  const withoutHash = route.split("#")[0] ?? "/";
  const [pathname, query] = withoutHash.split("?");
  return { pathname: pathname || "/", search: query ? `?${query}` : "" };
}

export function isOnStepRoute(step: TutorialStep, pathname: string, search: string): boolean {
  if (step.alsoOn?.includes(pathname)) return true;
  const target = routeLocation(step.route);
  if (target.pathname !== pathname) return false;
  if (!target.search) return true;
  const want = new URLSearchParams(target.search);
  const have = new URLSearchParams(search);
  return [...want.entries()].every(([key, value]) => have.get(key) === value);
}
