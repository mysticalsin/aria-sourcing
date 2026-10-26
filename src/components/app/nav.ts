import {
  LayoutDashboard,
  MailPlus,
  Target,
  Users,
  Send,
  MessageSquareReply,
  CalendarDays,
  LineChart,
  Settings,
  BarChart3,
  Workflow,
  Inbox,
  Bookmark,
  Rocket,
  ShieldCheck,
  Trophy,
  Mail,
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
  // Analyze — decision-maker reporting
  { href: "/exec", label: "Exec", icon: BarChart3, section: "Analyze", description: "Leadership KPI dashboard" },
  { href: "/winlog", label: "Winlog", icon: Trophy, section: "Analyze", description: "Booked-win learning records" },
  { href: "/reports", label: "Reports", icon: LineChart, section: "Analyze", description: "Learning loop" },
  { href: "/trust", label: "Trust & ROI", icon: ShieldCheck, section: "Analyze", description: "ROI calculator & compliance posture" },
  // System — configuration
  { href: "/fleet", label: "Mailboxes", icon: Mail, section: "System", description: "Sender mailboxes & suppression" },
  { href: "/settings", label: "Settings", icon: Settings, section: "System", description: "Integrations & compliance" },
];

/** Bottom-nav subset for small screens. The full nav is reachable via the
 *  hamburger drawer in the top bar (see TopBar) — this is the quick-access row. */
export const MOBILE_NAV: NavItem[] = ["/", "/funnel", "/applicants", "/candidates", "/settings"]
  .map((href) => NAV_ITEMS.find((n) => n.href === href))
  .filter((n): n is NavItem => Boolean(n));
