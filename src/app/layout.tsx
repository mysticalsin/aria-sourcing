import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "@/components/app/providers";
import { AppShell } from "@/components/app/app-shell";

export const metadata: Metadata = {
  title: {
    default: "Hermes Sourcing — Autonomous Recruiting Operations",
    template: "%s · Hermes Sourcing",
  },
  description:
    "Hermes turns job requests into booked interviews. Autonomous sourcing, human approval, machine speed. Dry-run by default.",
  applicationName: "Hermes Sourcing",
};

export const viewport: Viewport = {
  themeColor: "#f7f1e8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
