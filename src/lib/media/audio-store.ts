import { createFileStore, type FileStore } from "./file-store";

/**
 * On-disk audio storage: `data/music/<MusicTrack id>.mp3` (GAMEEXPLOR-0025).
 *
 * The same store as maps, journal photos and manual scans — same id allowlist,
 * same resolved-path check, same "outside db:snapshot, inside npm run backup"
 * stance — with an MP3 sniffer where `sniffImage` sits for pixels.
 *
 * MP3 only, decided with the owner. Not MIDI, not FLAC, not WAV: one content
 * type keeps the serve route honest, and every browser that can play anything
 * can play this.
 */

export const AUDIO_CONTENT_TYPE = "audio/mpeg";

/** A soundtrack track is a few MB; 32 leaves room for a long, lossless-ish rip. */
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

const AUDIO_FORMATS = [{ ext: "mp3", contentType: AUDIO_CONTENT_TYPE }] as const;

/**
 * Is this actually an MP3?
 *
 * Two shapes count, because both are what real files look like: an `ID3` tag
 * (nearly every tagged rip starts with one), or a raw MPEG audio frame — 11 set
 * sync bits, then a version and layer that are not the reserved values. A
 * leading ID3 tag is trusted without walking to the first frame; a file that
 * lies about its own tag is the owner's own file, not an attacker's.
 *
 * Returns the content type to store, or null — which the service turns into a
 * `415`, the same answer a non-image gets from the image routes.
 */
export function sniffAudio(buf: Buffer): string | null {
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return AUDIO_CONTENT_TYPE;
  // Skip a leading ID3v1-style pad or stray zero bytes some rippers emit.
  let i = 0;
  while (i < buf.length && i < 4 && buf[i] === 0x00) i++;
  if (buf.length >= i + 4 && buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
    const version = (buf[i + 1] >> 3) & 0x03;
    const layer = (buf[i + 1] >> 1) & 0x03;
    // version 01 and layer 00 are reserved: a byte that hits those is noise
    // that happens to start with a sync word, not audio.
    if (version !== 0x01 && layer !== 0x00) return AUDIO_CONTENT_TYPE;
  }
  return null;
}

export function createAudioStore(dir: string): FileStore {
  return createFileStore(dir, AUDIO_FORMATS);
}
