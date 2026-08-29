import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Game Explorer", template: "%s · Game Explorer" },
  description: "Browse the shelf. Pick a game.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Games" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
