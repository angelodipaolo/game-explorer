import { SiteHeader } from "@/components/site-header";
import { MusicSettingsPanel } from "@/components/music/music-settings";

export const metadata = { title: "Settings" };

/**
 * Per-device preferences (GAMEEXPLOR-0025).
 *
 * Public, deliberately: nothing here touches the collection. Every setting on
 * this page lives in *your* browser's `localStorage`, so a visitor on the
 * tunnel can turn music on for themselves without being the owner, and the
 * owner's phone and the TV in the living room disagree happily.
 */
export default function SettingsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Saved in this browser, on this device. Nothing here is shared with anyone else looking at the collection.</p>
        <div className="mt-5 grid gap-4">
          <MusicSettingsPanel />
        </div>
      </main>
    </>
  );
}
