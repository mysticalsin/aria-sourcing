import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { Providers } from "@/components/app/providers";
import { AppShell } from "@/components/app/app-shell";
import { Geist, EB_Garamond } from "next/font/google";

const geist = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-geist",
  display: "swap",
});

const garamond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-garamond",
  display: "swap",
});

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
    <html lang="en" data-scroll-behavior="smooth" className={`${geist.variable} ${garamond.variable}`}>
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
