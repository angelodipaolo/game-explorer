"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { gameIdFromPathname, pickTrack, serverSettingsSnapshot, settingsSnapshot, subscribeSettings, type PlayableTrack } from "@/lib/music/player";

/**
 * Background music while you browse a game (GAMEEXPLOR-0025).
 *
 * Mounted **once**, in the root layout, and never unmounted — that is the
 * whole design. One `<audio>` element outlives every soft navigation, so
 * walking from a game to its map to its manual keeps the same track playing
 * instead of restarting it, and no page has to know music exists.
 *
 * It is driven by the pathname and nothing else: `usePathname()` says which
 * game (if any) is on screen — the id in `/game/<id>` is the owned copy, the
 * same id the API keys tracks on, so there is nothing to resolve — that copy's
 * soundtrack comes from `GET /api/games/:id/music`, and one of its tracks is
 * picked at random. A game
 * with no registered music, and every route that is not a game page, stops the
 * audio. No context, no provider, no props threaded through pages.
 *
 * **Autoplay.** A browser rejects `play()` until the document has seen a user
 * gesture, and a rejected promise here is an error in the console of a page
 * the owner is showing someone. So `play()` is never called speculatively:
 * `gestured` must be true first — set by any pointer, touch or key event
 * anywhere in the app, which includes the tap that turned music on. If it is
 * rejected anyway (Safari counts gestures more strictly than the spec reads)
 * the rejection is swallowed and a small "Play music" button appears. That
 * button is then the gesture.
 *
 * The track itself is held in refs rather than state: nothing about it is
 * rendered, and re-rendering the whole layout because a song changed would be
 * pure waste. The one piece of state is which game's playback the browser
 * blocked, and it is keyed by game id so navigating away hides the affordance
 * without anything having to clear it.
 */
export function MusicPlayer() {
  const pathname = usePathname();
  const gameId = gameIdFromPathname(pathname);
  const settings = useSyncExternalStore(subscribeSettings, settingsSnapshot, serverSettingsSnapshot);
  const { enabled, volume } = settings;

  const audioRef = useRef<HTMLAudioElement>(null);
  const tracksRef = useRef<PlayableTrack[]>([]);
  const currentRef = useRef<PlayableTrack | null>(null);
  const gameRef = useRef<string | null>(null);
  const volumeRef = useRef(volume);
  // A ref, not state: it is read inside callbacks that must not be rebuilt
  // when it flips, and re-rendering on the first tap of the visit is pointless.
  const gestured = useRef(false);
  const [blockedGame, setBlockedGame] = useState<string | null>(null);

  const stop = useCallback(() => {
    tracksRef.current = [];
    currentRef.current = null;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    // Drop the source too, so a paused element is not still holding a request
    // open against the server while you browse the shelf.
    if (audio.getAttribute("src")) {
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);

  const start = useCallback((track: PlayableTrack) => {
    const audio = audioRef.current;
    if (!audio) return;
    const forGame = gameRef.current;
    currentRef.current = track;
    const src = `/api/music/${encodeURIComponent(track.id)}/audio`;
    if (audio.getAttribute("src") !== src) {
      audio.pause();
      audio.src = src;
      audio.load();
    }
    audio.volume = volumeRef.current;
    if (!gestured.current) {
      // Nothing has been touched yet this page-load. Calling play() here would
      // only produce a console error; offer the button instead.
      setBlockedGame(forGame);
      return;
    }
    audio
      .play()
      .then(() => setBlockedGame(null))
      .catch(() => setBlockedGame(forGame));
  }, []);

  // Any tap, click or key anywhere in the app is the gesture the autoplay
  // policy wants — including the one that flipped the toggle on /settings.
  // Capture phase, so a handler that stops propagation cannot hide it.
  useEffect(() => {
    // `isTrusted` is what makes this ref mean what its name says: a
    // script-dispatched PointerEvent would set it, the browser would still
    // refuse `play()`, and the flag would be lying rather than merely wrong.
    const mark = (e: Event) => {
      if (!e.isTrusted) return;
      gestured.current = true;
    };
    const passive = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", mark, passive);
    window.addEventListener("touchstart", mark, passive);
    window.addEventListener("keydown", mark, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", mark, passive);
      window.removeEventListener("touchstart", mark, passive);
      window.removeEventListener("keydown", mark, { capture: true });
    };
  }, []);

  // Volume rides on its own effect so dragging the slider never reloads audio.
  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Which game, and therefore which soundtrack. Re-runs on navigation between
  // games and on the toggle — not on a volume change, and not on
  // `/game/x` → `/game/x/map`, which is the same id and the same track.
  useEffect(() => {
    const changedGame = gameRef.current !== gameId;
    gameRef.current = gameId;
    if (!enabled || !gameId) {
      stop();
      return;
    }
    // The previous game's track stops *before* the new game's lookup, not
    // after it lands. Otherwise a slow request leaves Metal Gear Solid playing
    // over The Last of Us's page for as long as the round trip takes — brief on
    // a LAN, but "the music matches the game on screen" is the whole feature.
    if (changedGame) stop();
    const controller = new AbortController();
    fetch(`/api/games/${encodeURIComponent(gameId)}/music`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`music lookup failed: ${res.status}`))))
      .then((data: unknown) => {
        const raw = data && typeof data === "object" ? (data as { tracks?: unknown }).tracks : null;
        const tracks = Array.isArray(raw) ? raw.filter((t): t is PlayableTrack => !!t && typeof (t as PlayableTrack).id === "string") : [];
        tracksRef.current = tracks;
        const next = pickTrack(tracks);
        // An unsupported game is silent, and shows no affordance offering to
        // start something that does not exist.
        if (next) start(next);
        else stop();
      })
      .catch(() => {
        // A failed lookup is silence, never a broken page. This also catches
        // the abort fired by navigating away mid-request.
        if (!controller.signal.aborted) stop();
      });
    return () => controller.abort();
  }, [gameId, enabled, start, stop]);

  // One track ending should not mean silence for the rest of the visit: pick
  // another from the same game, avoiding an immediate repeat when there is one.
  const onEnded = useCallback(() => {
    const next = pickTrack(tracksRef.current, Math.random, currentRef.current?.id);
    if (!next) return;
    const audio = audioRef.current;
    if (audio && next.id === currentRef.current?.id) {
      // The same track, because it is the only one: rewind rather than
      // reassigning an identical `src`, which would not reload anything.
      audio.currentTime = 0;
      audio.play().catch(() => setBlockedGame(gameRef.current));
      return;
    }
    start(next);
  }, [start]);

  const startFromTap = () => {
    gestured.current = true;
    const track = currentRef.current;
    if (track) start(track);
  };

  return (
    <>
      <audio ref={audioRef} onEnded={onEnded} preload="none" hidden aria-hidden="true" data-testid="music-audio" />
      {enabled && gameId && blockedGame === gameId ? (
        <button
          type="button"
          onClick={startFromTap}
          data-testid="music-start"
          className="fixed bottom-4 right-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-bg-elev/95 px-4 text-sm text-muted shadow-lg backdrop-blur transition hover:border-muted hover:text-text"
        >
          <span aria-hidden="true">♪</span>
          Play music
        </button>
      ) : null}
    </>
  );
}
