import type { Metadata, Viewport } from "next";
import { MusicPlayer } from "@/components/music/music-player";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Game Explorer", template: "%s · Game Explorer" },
  description: "Browse the shelf. Pick a game.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Games" },
  // Hosted publicly (GAMEEXPLOR-0002) but not published: a link you were given,
  // never a search result. Also in robots.ts and as a header from src/proxy.ts.
  robots: { index: false, follow: false },
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
      <body className="min-h-dvh bg-bg text-text antialiased">
        {children}
        {/* One <audio> for the whole app (GAMEEXPLOR-0025). It has to be here,
            outside every page, so a track survives navigating from a game to
            its map and stops on its own when you leave for the shelf. Silent
            unless this device turned music on in /settings. */}
        <MusicPlayer />
      </body>
    </html>
  );
}
