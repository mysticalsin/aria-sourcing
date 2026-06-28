import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "@/components/app/providers";
import { AppShell } from "@/components/app/app-shell";

export const metadata: Metadata = {
  title: {
    default: "Aria Sourcing by Mantu: Autonomous Recruiting Operations",
    template: "%s · Aria by Mantu",
  },
  description:
    "Aria turns job requests into booked interviews. Autonomous sourcing, human approval, machine speed. A Mantu company. Dry-run by default.",
  applicationName: "Aria Sourcing by Mantu",
};

export const viewport: Viewport = {
  themeColor: "#6600AE",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Cinematic login hero fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Root-layout links load globally — the per-page-font rule does not apply. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500&display=swap" rel="stylesheet" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://db.onlinewebfonts.com/c/2bf40ab72ea4897a3fd9b6e48b233a19?family=Garamond" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
