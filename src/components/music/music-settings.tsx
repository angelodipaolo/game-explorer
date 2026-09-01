"use client";

import { useSyncExternalStore } from "react";
import { MUSIC_SETTINGS_KEY, canStoreSettings, serverSettingsSnapshot, settingsSnapshot, subscribeSettings, writeSettings, type MusicSettings } from "@/lib/music/player";

/**
 * The music controls on /settings (GAMEEXPLOR-0025).
 *
 * The setting belongs to **this browser**, not to the collection: it is
 * `localStorage` on the device in your hand, so turning music on for the TV in
 * the living room leaves a visitor on the tunnel in silence. Default off.
 *
 * Read through `useSyncExternalStore` (the same store the `<MusicPlayer>` in
 * the root layout subscribes to) so the toggle and the audio never disagree,
 * and so the server render — which has no `localStorage` — hydrates cleanly.
 * Flipping the toggle is also, conveniently, exactly the click the autoplay
 * policy wants: music starts the moment it is turned on with a game page open
 * in another tab, and on the next game page in this one.
 */
export function MusicSettingsPanel() {
  const settings = useSyncExternalStore(subscribeSettings, settingsSnapshot, serverSettingsSnapshot);
  const storable = useSyncExternalStore(subscribeSettings, canStoreSettings, () => true);
  const update = (next: MusicSettings) => writeSettings(next);

  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-labelledby="music-settings-heading">
      <h2 id="music-settings-heading" className="font-display text-lg font-bold">
        Music
      </h2>
      <p className="mt-1 text-sm text-muted">
        Play something from a game&apos;s soundtrack while its page is open. Only games with music registered on this server make a sound — everything else stays quiet.
      </p>

      <label className="mt-4 flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface-2 px-4" htmlFor="music-enabled">
        <input id="music-enabled" type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={settings.enabled} onChange={(e) => update({ ...settings, enabled: e.target.checked })} data-testid="music-enabled" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Background music</span>
          <span className="block text-xs text-muted">Off by default. Remembered on this device only.</span>
        </span>
      </label>

      <div className="mt-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
        <label className="flex items-center justify-between text-sm font-semibold" htmlFor="music-volume">
          Volume
          <span className="tabular-nums text-muted">{Math.round(settings.volume * 100)}%</span>
        </label>
        <input id="music-volume" type="range" min={0} max={100} step={5} className="mt-2 w-full accent-[var(--accent)]" value={Math.round(settings.volume * 100)} onChange={(e) => update({ ...settings, volume: Number(e.target.value) / 100 })} data-testid="music-volume" />
      </div>

      {storable ? null : (
        <p className="mt-3 text-xs text-warn">
          This browser will not let the page store anything (a private window, usually), so the choice holds for this visit and is forgotten when you reload. The key, when it can be stored, is <code>{MUSIC_SETTINGS_KEY}</code>.
        </p>
      )}
    </section>
  );
}
