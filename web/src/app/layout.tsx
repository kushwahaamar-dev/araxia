import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Araxia — wearable permission",
    template: "%s — Araxia",
  },
  description:
    "Small One is a demo bank. Araxia decides whether this exact action, approved by this present human, may execute. Not a real bank.",
  applicationName: "Araxia",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/favicon.png",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ibmPlexMono.variable} h-full`}>
      <body className="min-h-full overflow-x-hidden">{children}</body>
    </html>
  );
}
