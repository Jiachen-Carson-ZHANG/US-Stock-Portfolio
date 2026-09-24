import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StaleCodeGuard } from "@/components/layout/stale-code-guard";

export const metadata: Metadata = {
  title: "Family Portfolio",
  description: "Private family portfolio viewer.",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* At the root so every page reports its browser errors — the sign-in
          and sign-up pages included, which sit outside the app layout. */}
      <body className="min-h-dvh antialiased">
        <StaleCodeGuard />
        {children}
      </body>
    </html>
  );
}
