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
  Sparkles,
  History,
  FolderSearch,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: "Operate" | "System";
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Command Center", icon: LayoutDashboard, section: "Operate", description: "Live operations overview" },
  { href: "/intake", label: "Intake", icon: MailPlus, section: "Operate", description: "Email + JD parser" },
  { href: "/campaigns", label: "Campaigns", icon: Target, section: "Operate", description: "Sourcing campaigns" },
  { href: "/candidates", label: "Candidates", icon: Users, section: "Operate", description: "Talent intelligence" },
  { href: "/outreach", label: "Outreach", icon: Send, section: "Operate", description: "Approval queue" },
  { href: "/replies", label: "Replies", icon: MessageSquareReply, section: "Operate", description: "Reply classification" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, section: "Operate", description: "Interview bookings" },
  { href: "/fleet", label: "Agent Fleet", icon: Bot, section: "Operate", description: "Multi-agent coordination" },
  { href: "/floor", label: "Ops Floor", icon: Building2, section: "Operate", description: "Live agent floor" },
  { href: "/chat", label: "Chat", icon: MessageSquare, section: "Operate", description: "Per-agent chat" },
  { href: "/reports", label: "Reports", icon: LineChart, section: "Operate", description: "Learning loop" },
  { href: "/skills", label: "Skills", icon: Brain, section: "System", description: "Learned playbooks" },
  { href: "/memory", label: "Memory", icon: Database, section: "System", description: "Agent long-term memory" },
  { href: "/sessions", label: "Sessions", icon: History, section: "System", description: "Chat & activity history" },
  { href: "/curator", label: "Files", icon: FolderSearch, section: "System", description: "Aria files & curator" },
  { href: "/soul", label: "Soul", icon: Sparkles, section: "System", description: "Agent personas & brain" },
  { href: "/settings", label: "Settings", icon: Settings, section: "System", description: "Integrations & compliance" },
];

/** Bottom-nav subset for small screens. */
export const MOBILE_NAV: NavItem[] = NAV_ITEMS.filter((n) =>
  ["/", "/campaigns", "/candidates", "/outreach", "/settings"].includes(n.href),
);
