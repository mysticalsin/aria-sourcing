import {
  LayoutDashboard,
  Target,
  Users,
  Send,
  MessageSquareReply,
  CalendarDays,
  Settings,
  BarChart3,
  Workflow,
  Mail,
  History,
  Brain,
  type LucideIcon,
} from "lucide-react";

export type NavSection = "Home" | "Recruit" | "Engage" | "Analyze" | "System";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSection;
  description: string;
  /** Other routes that belong to this entry (its tabs), so it stays lit there. */
  match?: string[];
}

/** The one way to create a campaign, for one role or several. */
export const NEW_CAMPAIGN_HREF = "/campaigns/new";

/** Sections with a heading, in order. Home sits above them on its own. */
export const NAV_SECTIONS = ["Recruit", "Engage", "Analyze", "System"] as const;

/** Pages reached through one nav entry and switched with tabs (see SectionTabs). */
export const CANDIDATE_TABS = [
  { href: "/candidates", label: "All candidates" },
  { href: "/applicants", label: "Applicants" },
  { href: "/vivier", label: "Talent pool" },
];

export const REPORT_TABS = [
  { href: "/exec", label: "Overview" },
  { href: "/reports", label: "Learning loop" },
  { href: "/winlog", label: "Wins" },
  { href: "/trust", label: "Trust & ROI" },
];

export const SECTION_TABS = [CANDIDATE_TABS, REPORT_TABS];

// Grouped around the recruiter's day: find people, talk to them, then measure.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: LayoutDashboard, section: "Home", description: "Today's action queue" },
  { href: "/campaigns", label: "Campaigns", icon: Target, section: "Recruit", description: "Sourcing campaigns" },
  {
    href: "/candidates",
    label: "Candidates",
    icon: Users,
    section: "Recruit",
    description: "All candidates, applicants and the talent pool",
    match: CANDIDATE_TABS.map((t) => t.href),
  },
  { href: "/funnel", label: "Pipeline", icon: Workflow, section: "Recruit", description: "Hiring pipeline by stage" },
  { href: "/outreach", label: "Outreach", icon: Send, section: "Engage", description: "Messages awaiting approval" },
  { href: "/replies", label: "Replies", icon: MessageSquareReply, section: "Engage", description: "Candidate replies" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, section: "Engage", description: "Interview bookings" },
  {
    href: "/exec",
    label: "Reports",
    icon: BarChart3,
    section: "Analyze",
    description: "KPIs, learning loop, wins and ROI",
    match: REPORT_TABS.map((t) => t.href),
  },
  { href: "/fleet", label: "Mailboxes", icon: Mail, section: "System", description: "Sender mailboxes & suppression" },
  { href: "/skills", label: "Skills", icon: Brain, section: "System", description: "Learned playbooks" },
  { href: "/sessions", label: "History", icon: History, section: "System", description: "Candidate journeys & audit pack" },
  { href: "/settings", label: "Settings", icon: Settings, section: "System", description: "Integrations & compliance" },
];

function underRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return [item.href, ...(item.match ?? [])].some((href) => underRoute(pathname, href));
}

/** The tab group the current page belongs to, if any. */
export function sectionTabsFor(pathname: string) {
  return SECTION_TABS.find((tabs) => tabs.some((t) => underRoute(pathname, t.href)));
}

/** Bottom-nav subset for small screens: the daily work queues. The full nav is
 *  reachable via the hamburger drawer in the top bar (see TopBar). */
export const MOBILE_NAV: NavItem[] = ["/", "/campaigns", "/candidates", "/outreach", "/replies"]
  .map((href) => NAV_ITEMS.find((n) => n.href === href))
  .filter((n): n is NavItem => Boolean(n));

/** Every page the command search can open: nav entries, their tabs and the
 *  new-campaign flow. */
export const SEARCH_PAGES: { href: string; label: string; description: string }[] = [
  { href: NEW_CAMPAIGN_HREF, label: "New campaign", description: "One role or several, from a brief or an email" },
  ...NAV_ITEMS,
  ...SECTION_TABS.flat()
    .filter((tab) => !NAV_ITEMS.some((n) => n.href === tab.href))
    .map((tab) => ({ ...tab, description: NAV_ITEMS.find((n) => n.match?.includes(tab.href))?.label ?? "" })),
];
