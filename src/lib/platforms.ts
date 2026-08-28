/**
 * Canonical platform slugs and the aliases that resolve to them.
 * The slug is what OwnedGame.platform stores. igdbId is IGDB's platform id.
 */
export type PlatformInfo = {
  slug: string;
  name: string;
  short: string;
  igdbId: number;
  aliases: string[];
  /** Rough era ordering for display. */
  year: number;
};

export const PLATFORMS: PlatformInfo[] = [
  { slug: "nes", name: "Nintendo Entertainment System", short: "NES", igdbId: 18, year: 1985, aliases: ["nintendo", "famicom", "nintendo entertainment system", "nes"] },
  { slug: "snes", name: "Super Nintendo Entertainment System", short: "SNES", igdbId: 19, year: 1991, aliases: ["super nintendo", "super nes", "super nintendo entertainment system", "super famicom", "sfc", "snes"] },
  { slug: "n64", name: "Nintendo 64", short: "N64", igdbId: 4, year: 1996, aliases: ["nintendo 64", "n64"] },
  { slug: "gamecube", name: "Nintendo GameCube", short: "GameCube", igdbId: 21, year: 2001, aliases: ["gamecube", "game cube", "ngc", "gcn"] },
  { slug: "wii", name: "Wii", short: "Wii", igdbId: 5, year: 2006, aliases: ["nintendo wii", "wii"] },
  { slug: "wiiu", name: "Wii U", short: "Wii U", igdbId: 41, year: 2012, aliases: ["wii u", "wiiu"] },
  { slug: "switch", name: "Nintendo Switch", short: "Switch", igdbId: 130, year: 2017, aliases: ["nintendo switch", "switch", "nsw"] },
  { slug: "switch2", name: "Nintendo Switch 2", short: "Switch 2", igdbId: 508, year: 2025, aliases: ["nintendo switch 2", "switch 2", "switch2", "ns2"] },
  { slug: "gb", name: "Game Boy", short: "GB", igdbId: 33, year: 1989, aliases: ["game boy", "gameboy", "gb"] },
  { slug: "gbc", name: "Game Boy Color", short: "GBC", igdbId: 22, year: 1998, aliases: ["game boy color", "gameboy color", "gbc"] },
  { slug: "gba", name: "Game Boy Advance", short: "GBA", igdbId: 24, year: 2001, aliases: ["game boy advance", "gameboy advance", "gba"] },
  { slug: "ds", name: "Nintendo DS", short: "DS", igdbId: 20, year: 2004, aliases: ["nintendo ds", "nds", "ds"] },
  { slug: "3ds", name: "Nintendo 3DS", short: "3DS", igdbId: 37, year: 2011, aliases: ["nintendo 3ds", "3ds"] },
  { slug: "sms", name: "Sega Master System", short: "Master System", igdbId: 64, year: 1986, aliases: ["master system", "sega master system", "sms"] },
  { slug: "genesis", name: "Sega Genesis", short: "Genesis", igdbId: 29, year: 1989, aliases: ["genesis", "sega genesis", "mega drive", "megadrive", "sega mega drive"] },
  { slug: "saturn", name: "Sega Saturn", short: "Saturn", igdbId: 32, year: 1994, aliases: ["saturn", "sega saturn"] },
  { slug: "dreamcast", name: "Sega Dreamcast", short: "Dreamcast", igdbId: 23, year: 1998, aliases: ["dreamcast", "sega dreamcast", "dc"] },
  { slug: "ps1", name: "PlayStation", short: "PS1", igdbId: 7, year: 1994, aliases: ["playstation", "playstation 1", "ps1", "psx", "psone", "ps one"] },
  { slug: "ps2", name: "PlayStation 2", short: "PS2", igdbId: 8, year: 2000, aliases: ["playstation 2", "ps2"] },
  { slug: "ps3", name: "PlayStation 3", short: "PS3", igdbId: 9, year: 2006, aliases: ["playstation 3", "ps3"] },
  { slug: "ps4", name: "PlayStation 4", short: "PS4", igdbId: 48, year: 2013, aliases: ["playstation 4", "ps4"] },
  { slug: "ps5", name: "PlayStation 5", short: "PS5", igdbId: 167, year: 2020, aliases: ["playstation 5", "ps5"] },
  { slug: "psp", name: "PlayStation Portable", short: "PSP", igdbId: 38, year: 2004, aliases: ["playstation portable", "psp"] },
  { slug: "vita", name: "PlayStation Vita", short: "Vita", igdbId: 46, year: 2011, aliases: ["playstation vita", "ps vita", "vita"] },
  { slug: "xbox", name: "Xbox", short: "Xbox", igdbId: 11, year: 2001, aliases: ["xbox", "original xbox"] },
  { slug: "x360", name: "Xbox 360", short: "360", igdbId: 12, year: 2005, aliases: ["xbox 360", "x360", "360"] },
  { slug: "xone", name: "Xbox One", short: "Xbox One", igdbId: 49, year: 2013, aliases: ["xbox one", "xone", "xb1"] },
  { slug: "atari2600", name: "Atari 2600", short: "2600", igdbId: 59, year: 1977, aliases: ["atari", "atari 2600", "2600", "vcs"] },
  { slug: "tg16", name: "TurboGrafx-16", short: "TG-16", igdbId: 86, year: 1987, aliases: ["turbografx", "turbografx-16", "turbografx 16", "tg16", "tg-16", "pc engine"] },
  { slug: "neogeo", name: "Neo Geo", short: "Neo Geo", igdbId: 80, year: 1990, aliases: ["neo geo", "neogeo", "neo-geo", "neo geo aes"] },
  { slug: "3do", name: "3DO Interactive Multiplayer", short: "3DO", igdbId: 50, year: 1993, aliases: ["3do", "3do interactive multiplayer", "panasonic 3do"] },
  { slug: "pc", name: "PC", short: "PC", igdbId: 6, year: 1981, aliases: ["pc", "windows", "pc (microsoft windows)", "dos"] },
];

const bySlug = new Map(PLATFORMS.map((p) => [p.slug, p]));
const byAlias = new Map<string, PlatformInfo>();
const byCompact = new Map<string, PlatformInfo>();
for (const p of PLATFORMS) {
  byAlias.set(p.slug, p);
  byCompact.set(p.slug, p);
  for (const a of p.aliases) {
    byAlias.set(normalizeAlias(a), p);
    byCompact.set(normalizeAlias(a).replace(/\s/g, ""), p);
  }
}

function normalizeAlias(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Resolve free text (`Nintendo`, `NES`, `Nintendo Entertainment System`) to a slug. */
export function resolvePlatform(input: string | null | undefined): PlatformInfo | null {
  if (!input) return null;
  const key = normalizeAlias(input);
  if (!key) return null;
  return byAlias.get(key) ?? byCompact.get(key.replace(/\s/g, "")) ?? null;
}

export function platformBySlug(slug: string): PlatformInfo | null {
  return bySlug.get(slug) ?? null;
}

export function platformByIgdbId(id: number): PlatformInfo | null {
  return PLATFORMS.find((p) => p.igdbId === id) ?? null;
}

export function platformLabel(slug: string): string {
  return bySlug.get(slug)?.short ?? slug.toUpperCase();
}
