import {
  LayoutDashboard,
  MailPlus,
  Target,
  Users,
  Send,
  MessageSquare,
  MessageSquareReply,
  CalendarDays,
  LineChart,
  Settings,
  Bot,
  Brain,
  Building2,
  Database,
  BarChart3,
  Sparkles,
  History,
  FolderSearch,
  Workflow,
  Inbox,
  Bookmark,
  Network,
  Rocket,
  Rewind,
  ShieldCheck,
  Trophy,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: "Operate" | "Analyze" | "System";
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  // Operate — day-to-day sourcing & recruiting work
  { href: "/", label: "Command Center", icon: LayoutDashboard, section: "Operate", description: "Live operations overview" },
  { href: "/funnel", label: "Funnel", icon: Workflow, section: "Operate", description: "TAnIA hiring funnel" },
  { href: "/intake", label: "Intake", icon: MailPlus, section: "Operate", description: "Email + JD parser" },
  { href: "/launch", label: "Launch", icon: Rocket, section: "Operate", description: "Multi-role batch launch" },
  { href: "/campaigns", label: "Campaigns", icon: Target, section: "Operate", description: "Sourcing campaigns" },
  { href: "/applicants", label: "Applicants", icon: Inbox, section: "Operate", description: "Chatbox applicant inbox" },
  { href: "/candidates", label: "Candidates", icon: Users, section: "Operate", description: "Talent intelligence" },
  { href: "/vivier", label: "#Vivier", icon: Bookmark, section: "Operate", description: "Talent pool" },
  { href: "/outreach", label: "Outreach", icon: Send, section: "Operate", description: "Approval queue" },
  { href: "/replies", label: "Replies", icon: MessageSquareReply, section: "Operate", description: "Reply classification" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, section: "Operate", description: "Interview bookings" },
  { href: "/fleet", label: "Agent Fleet", icon: Bot, section: "Operate", description: "Multi-agent coordination" },
  { href: "/floor", label: "Ops Floor", icon: Building2, section: "Operate", description: "Live agent floor" },
  { href: "/chat", label: "Chat", icon: MessageSquare, section: "Operate", description: "Per-agent chat" },
  // Analyze — hindsight, metrics & compliance posture
  { href: "/replay", label: "Replay", icon: Rewind, section: "Analyze", description: "Scrub the agents' whole day" },
  { href: "/exec", label: "Exec", icon: BarChart3, section: "Analyze", description: "Leadership KPI dashboard" },
  { href: "/winlog", label: "Winlog", icon: Trophy, section: "Analyze", description: "Booked-win learning records" },
  { href: "/reports", label: "Reports", icon: LineChart, section: "Analyze", description: "Learning loop" },
  { href: "/sessions", label: "Sessions", icon: History, section: "Analyze", description: "Chat & activity history" },
  { href: "/trust", label: "Trust & ROI", icon: ShieldCheck, section: "Analyze", description: "ROI calculator & compliance posture" },
  // System — agent architecture, config & platform internals
  { href: "/studio", label: "Agent Studio", icon: Wand2, section: "System", description: "Build & tune sourcing agents" },
  { href: "/architecture", label: "Architecture", icon: Network, section: "System", description: "TAnIA agent org & guardrails" },
  { href: "/skills", label: "Skills", icon: Brain, section: "System", description: "Learned playbooks" },
  { href: "/memory", label: "Memory", icon: Database, section: "System", description: "Agent long-term memory" },
  { href: "/curator", label: "Files", icon: FolderSearch, section: "System", description: "Aria files & curator" },
  { href: "/soul", label: "Soul", icon: Sparkles, section: "System", description: "Agent personas & brain" },
  { href: "/settings", label: "Settings", icon: Settings, section: "System", description: "Integrations & compliance" },
];

/** Bottom-nav subset for small screens. The full nav is reachable via the
 *  hamburger drawer in the top bar (see TopBar) — this is the quick-access row. */
export const MOBILE_NAV: NavItem[] = ["/", "/funnel", "/applicants", "/candidates", "/settings"]
  .map((href) => NAV_ITEMS.find((n) => n.href === href))
  .filter((n): n is NavItem => Boolean(n));
