import path from "node:path";
import { createAudioStore, MAX_AUDIO_BYTES } from "@/lib/media/audio-store";

/**
 * Where a track's bytes live: `data/music/<MusicTrack id>.mp3`.
 *
 * Keyed by row id like every other blob directory here, so nothing anywhere
 * takes a filename from a caller — a request names a track id, and that id has
 * to be a bare cuid before it can name a file at all.
 *
 * Same stance as data/maps/, data/journal/ and data/manuals/: private,
 * gitignored, and *not* part of db:snapshot. The snapshot carries the
 * `MusicTrack` rows; `npm run backup` carries the audio. A restore without the
 * files leaves every track listed and silent.
 */
export const MUSIC_DIR = process.env.MUSIC_DIR ?? path.resolve(process.cwd(), "data/music");

export const musicFiles = createAudioStore(MUSIC_DIR);
export { MAX_AUDIO_BYTES };

export type ByteRange = { start: number; end: number };

/**
 * Parse a `Range: bytes=…` header against a known size.
 *
 * `null` means "no range asked for, send the whole thing"; `"unsatisfiable"`
 * means answer `416`. Only a single range is honoured — Safari and Chrome ask
 * for one at a time when scrubbing audio, and a multipart/byteranges body
 * would be a lot of machinery for a feature that plays one track start to end.
 * A multi-range request therefore falls back to the whole file, which is a
 * legal response to any `Range`.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // `bytes=-500`: the last 500 bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(size - 1, Number(rawEnd));
  if (end < start) return "unsatisfiable";
  return { start, end };
}
