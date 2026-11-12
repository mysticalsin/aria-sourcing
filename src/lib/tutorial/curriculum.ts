import { recordedCandidateLawfulBasis } from "@/lib/candidate-lawful-basis";
import type { WorkspaceState } from "@/lib/types";

/* ============================================================================
   Tutorial curriculum — the step-by-step walkthrough opened from the menu.
   Pure data plus small helpers, so the copy, the routes and the completion
   checks can be tested without a browser. The panel that renders it lives in
   src/components/tutorial/tutorial.tsx.
   ========================================================================== */

/** What the tutorial watches to notice that the learner did the exercise. */
export interface TutorialCounts {
  campaigns: number;
  candidates: number;
  outreach: number;
  approved: number;
  followUps: number;
  replyDrafts: number;
  talentPool: number;
  contactBasis: number;
  /** Candidates whose profile facts the recruiter recorded ("Verify the profile"). */
  verified: number;
}

export function tutorialCounts(
  state: Pick<WorkspaceState, "campaigns" | "outreach" | "candidates">,
): TutorialCounts {
  return {
    campaigns: state.campaigns.length,
    candidates: state.candidates.length,
    outreach: state.outreach.length,
    approved: state.outreach.filter((m) => m.status === "Approved" || m.status === "Scheduled" || m.status === "Pending Manual Send")
      .length,
    followUps: state.outreach.filter((m) => m.sequenceStep > 1).length,
    replyDrafts: state.outreach.filter((m) => Boolean(m.inReplyTo)).length,
    talentPool: state.candidates.filter((c) => c.vivier).length,
    contactBasis: state.candidates.filter((c) => recordedCandidateLawfulBasis(c) !== null).length,
    verified: state.candidates.filter((c) => (c.notes ?? []).some((n) => n.text.startsWith("Profile/contact facts recorded"))).length,
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
   *  the step page); being there does not count as having left the step.
   *  A trailing "/*" covers every page under that path (e.g. one campaign). */
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
          "Aria takes a recruiter from a job brief to a first conversation on LinkedIn. It reads the brief, finds people through a public web search, scores them and drafts the first message. You check each profile and approve each message.",
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
          "This chip shows the mode you are in. Live means real people from real searches. Dry-run covers email only: no email leaves. A LinkedIn message leaves from your own account, and only once you approve it.",
        tryIt: "Hover the chip (or tap it) to read the details.",
        route: "/",
        page: "Home",
        target: ['[data-tour="mode-chip"]'],
      },
      {
        id: "basics-home",
        title: "Home shows your next move",
        body:
          "The large card always holds the single most useful thing to do now, such as new candidates to review. The figures below say exactly what they count: real sends only, never simulated ones.",
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
        tryIt: "Paste a hiring email (or click “Sample backend role”), then “Parse JD”. The brief appears on the right.",
        route: "/campaigns/new",
        page: "New campaign",
        target: ['[data-tour="intake-brief"]'],
      },
      {
        id: "campaign-create",
        title: "Check it, then create",
        body:
          "Everything in the brief can be edited. Validation warnings point at gaps, and a suggested reply asks the hiring manager for what is missing. The skills you keep here are what candidates are scored against.",
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
          "When a client sends one brief for several roles, paste it whole, with --- between roles. Aria reads each role and creates one campaign per role. Each one then waits for you to review its search before anything runs.",
        tryIt: "Click “Load sample brief (6 roles)”, then “Launch”. One lane per role appears below.",
        route: "/campaigns/new?roles=several",
        page: "New campaign · Several roles",
        target: ['[data-tour="launch-brief"]'],
        done: (now, start) => now.campaigns >= start.campaigns + 2,
        doneText: "Campaigns created, one per role. Open each one to review its search.",
      },
    ],
  },
  {
    id: "find",
    title: "Find candidates",
    summary: "Search LinkedIn through public results, read the scores, and verify the profiles worth it.",
    minutes: 5,
    steps: [
      {
        id: "find-run",
        title: "Run a search",
        body:
          "On a campaign, Run sourcing opens the search plan: LinkedIn through Claude's web search on public profiles, with GitHub as an option. You check the query and the limit, then launch. Results are saved as the run goes.",
        tryIt: "Open your campaign, click “Run sourcing”, check the query, then launch it.",
        route: "/campaigns",
        page: "Campaigns",
        alsoOn: ["/campaigns/*"],
        target: ['[data-tour="run-aria"]'],
        done: (now, start) => now.candidates > start.candidates,
        doneText: "Candidates found and scored. They are in the campaign and under Candidates.",
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
        title: "Read the score",
        body:
          "A profile explains its score: each criterion with its weight and what is still unknown. A public search result shows little, so unknown facts keep a score low on purpose. Aria never guesses a skill.",
        tryIt: "Click a candidate and read the score breakdown on the Overview tab.",
        route: "/candidates",
        page: "Candidates",
        target: ['[data-tour="candidate-list"]'],
      },
      {
        id: "find-verify",
        title: "Verify the profile",
        body:
          "Open the person's LinkedIn and tick what it shows against the brief: skills, industry, company stage, location, years. The score is recomputed from what you saw. Your source note is kept with the facts.",
        tryIt:
          "In a candidate's panel, click “Reveal contact”, open “Evidence & contact”, tick what the profile shows, then click “Save and rescore”.",
        route: "/candidates",
        page: "Candidates",
        target: ['[data-tour="verify-profile"]', '[data-tour="candidate-list"]'],
        done: (now, start) => now.verified > start.verified,
        doneText: "Facts recorded and the score recomputed.",
      },
      {
        id: "find-pipeline",
        title: "The hiring pipeline",
        body:
          "One row per campaign, one column per stage: you see at a glance where each role stands, from sourced to hired.",
        tryIt: "Click a campaign to see its candidates under each stage, then click a name to open the profile.",
        route: "/funnel",
        page: "Pipeline",
        target: ['[data-tour="pipeline-board"]'],
      },
    ],
  },
  {
    id: "engage",
    title: "Talk to candidates",
    summary: "Connect your LinkedIn, record why you may contact someone, approve the message, follow the conversation.",
    minutes: 5,
    steps: [
      {
        id: "engage-linkedin",
        title: "Connect your LinkedIn",
        body:
          "Aria talks to LinkedIn through a small extension in your own Chrome, with your own session: no password stored, no robot browser. Sends are paced and capped per day. Each user connects their own account.",
        tryIt: "Open Your LinkedIn and check that the extension shows as connected.",
        route: "/settings#settings-section-20",
        page: "Settings · Your LinkedIn",
        target: ["#settings-section-20"],
      },
      {
        id: "engage-basis",
        title: "Record why you may contact someone",
        body:
          "Before a first message, you record the lawful basis for contacting this person (consent or legitimate interest) and your evidence. Aria never decides it for you: until it is recorded, approval stays blocked.",
        tryIt:
          "Open a candidate and go to the Compliance tab. Under Consent passport, pick a Contact basis, write your evidence (for example “Public LinkedIn profile, relevant work”), then click “Record contact basis”.",
        route: "/candidates",
        page: "Candidates",
        alsoOn: ["/outreach"],
        target: ['[data-tour="candidate-list"]'],
        done: (now, start) => now.contactBasis > start.contactBasis,
        doneText: "Basis recorded. Next, draft and approve this person's message.",
      },
      {
        id: "engage-approve",
        title: "Draft, then approve",
        body:
          "“Draft LinkedIn message” on a profile writes a first message from the person's own record. It waits in Outreach. Approving it is your decision to send: it leaves from your own LinkedIn within a minute or two.",
        tryIt: "Draft a message from the candidate's panel, then in Outreach read it and click “Approve”.",
        route: "/outreach",
        page: "Outreach",
        alsoOn: ["/candidates"],
        target: ['[data-tour="approval-queue"]'],
        done: (now, start) => now.approved > start.approved,
        doneText: "Approved. Your extension sends it from your LinkedIn; the candidate moves to Contacted.",
      },
      {
        id: "engage-conversation",
        title: "The conversation stays on the profile",
        body:
          "Replies and the whole LinkedIn thread appear in the candidate's LinkedIn tab, synced by your extension. Only conversations with sourced candidates are kept, never your whole inbox.",
        tryIt: "Open a contacted candidate and click the LinkedIn tab.",
        route: "/candidates",
        page: "Candidates",
        target: ['[data-tour="candidate-list"]'],
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
        id: "engage-autopilot",
        title: "Autopilot (proof of concept)",
        body:
          "On a campaign, the autopilot can search on a schedule and contact the best candidates from your LinkedIn, under an approval you sign for that campaign alone. The server can restrict it to a list of allowed profiles.",
        tryIt: "Open a campaign and read the Autopilot card. You do not need to turn it on for this tutorial.",
        route: "/campaigns",
        page: "Campaigns",
        alsoOn: ["/campaigns/*"],
        target: ['[data-tour="autopilot"]'],
      },
    ],
  },
  {
    id: "control",
    title: "Measure and stay in control",
    summary: "Read the report, set the rules, see what the AI costs and what was done.",
    minutes: 4,
    steps: [
      {
        id: "control-reports",
        title: "Reports",
        body:
          "Overview sums up the funnel, counting real sends only, and estimates the recruiter time saved. The value is an extrapolation from editable assumptions, not a measured saving.",
        tryIt: "Switch the period from 30d to All and watch the figures change.",
        route: "/exec",
        page: "Reports",
        target: ['[data-tour="exec-report"]'],
      },
      {
        id: "control-rules",
        title: "You set the rules",
        body:
          "Settings decide how much Aria may do alone: email dry-run, approval before every send, the minimum score to contact, daily limits and quiet hours. The defaults keep a person in charge.",
        tryIt: "Read the approval settings. There is no need to change them.",
        route: "/settings#settings-section-02",
        page: "Settings · Approval",
        target: ["#settings-section-02"],
      },
      {
        id: "control-ai",
        title: "Which AI does what",
        body:
          "Each task uses a suitable Claude model: Haiku to read briefs and classify, Sonnet to search and to write. The usage card shows this month's cost against the budget.",
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
        id: "control-history",
        title: "Every step leaves a trace",
        body:
          "History keeps each candidate's journey, from the search that found them to the message sent, with every reveal of contact details. It is the record to show when someone asks who did what.",
        tryIt: "Click a candidate under Decision Replay to read their journey.",
        route: "/sessions",
        page: "History",
        target: ['[data-tour="decision-replay"]'],
      },
      {
        id: "control-done",
        title: "You have seen all of Aria",
        body:
          "Reopen the tutorial from the menu whenever you like; your progress is kept. Start a new campaign from any brief: every step you practised here works the same on a real role.",
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
  const also = (step.alsoOn ?? []).some((path) => (path.endsWith("/*") ? pathname.startsWith(path.slice(0, -1)) : path === pathname));
  if (also) return true;
  const target = routeLocation(step.route);
  if (target.pathname !== pathname) return false;
  if (!target.search) return true;
  const want = new URLSearchParams(target.search);
  const have = new URLSearchParams(search);
  return [...want.entries()].every(([key, value]) => have.get(key) === value);
}
