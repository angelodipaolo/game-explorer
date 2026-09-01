import { describe, expect, it } from "vitest";
import { sniffAudio } from "@/lib/media/audio-store";
import { parseRange } from "./audio";

/**
 * Synthetic MP3 bytes. Nothing here decodes audio, and no test ever reads the
 * owner's own music — the point is bytes of a known shape.
 */
const id3 = (size = 64) => {
  const b = Buffer.alloc(size, 0x55);
  Buffer.from("ID3", "latin1").copy(b, 0);
  return b;
};

const frame = (size = 64) => {
  const b = Buffer.alloc(size, 0x00);
  // 11 sync bits, MPEG-1 (11), Layer III (01), 128 kbps, 44.1 kHz.
  b[0] = 0xff;
  b[1] = 0xfb;
  b[2] = 0x90;
  b[3] = 0x64;
  return b;
};

describe("sniffAudio", () => {
  it("accepts a tagged rip and a bare frame", () => {
    expect(sniffAudio(id3())).toBe("audio/mpeg");
    expect(sniffAudio(frame())).toBe("audio/mpeg");
  });

  it("refuses everything that is not an MP3", () => {
    // A PNG, a RIFF/WAVE header, an Ogg page, a MIDI file, JSON, and nothing.
    expect(sniffAudio(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(sniffAudio(Buffer.from("RIFF....WAVEfmt "))).toBeNull();
    expect(sniffAudio(Buffer.from("OggS "))).toBeNull();
    expect(sniffAudio(Buffer.from("MThd "))).toBeNull();
    expect(sniffAudio(Buffer.from('{"version":1}'))).toBeNull();
    expect(sniffAudio(Buffer.alloc(0))).toBeNull();
    // A sync word whose version and layer bits are the reserved values: noise
    // that happens to start with 11 set bits, not audio.
    expect(sniffAudio(Buffer.from([0xff, 0xe9, 0x00, 0x00]))).toBeNull();
  });
});

describe("parseRange", () => {
  it("passes through when nothing was asked for", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
    // Multi-range: legal to answer with the whole file.
    expect(parseRange("bytes=0-10,20-30", 100)).toBeNull();
    expect(parseRange("items=0-10", 100)).toBeNull();
  });

  it("reads the three shapes a media element sends", () => {
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  });

  it("calls out a range that cannot be satisfied", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-10", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});
