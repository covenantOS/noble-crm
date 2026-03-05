import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata: Metadata = {
  title: "Noble Estimator — Westchase Painting Company",
  description: "Professional painting estimate and contract management for Westchase Painting Company by Noble. Tampa Bay's premium residential painting service.",
  keywords: "painting estimate, Tampa Bay painter, Westchase painting, residential painting, house painting estimate",
  authors: [{ name: "Westchase Painting Company by Noble" }],
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a2744",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
