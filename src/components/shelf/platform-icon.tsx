import { cx } from "@/components/ui";

const ICONS = new Set([
  "nes", "snes", "n64", "gamecube", "wii", "wiiu", "switch", "switch2",
  "gb", "gbc", "gba", "ds", "3ds",
  "sms", "genesis", "saturn", "dreamcast",
  "ps1", "ps2", "ps3", "ps4", "ps5", "psp", "vita",
  "xbox", "x360", "xone",
  "atari2600", "tg16", "neogeo", "3do", "pc",
]);

/**
 * Per-system hardware silhouettes vendored in public/platform-icons/, one SVG
 * per slug from src/lib/platforms.ts. Rendered via CSS mask so the artwork
 * files stay verbatim upstream copies (their fills and viewBoxes vary) while
 * still tinting with currentColor. See public/platform-icons/LICENSE.md.
 */
export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const icon = ICONS.has(platform) ? platform : "generic";
  const mask = `url(/platform-icons/${icon}.svg)`;

  return (
    <span className={cx("relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-black/25", platformTone(platform), className)} aria-hidden="true">
      <span
        className="h-7 w-7 bg-current"
        style={{
          maskImage: mask, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center",
          WebkitMaskImage: mask, WebkitMaskSize: "contain", WebkitMaskRepeat: "no-repeat", WebkitMaskPosition: "center",
        }}
      />
      {platform === "switch2" ? <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-bg px-0.5 font-mono text-[0.5rem] font-black leading-none text-[#ff6975] ring-1 ring-[#ff6975]">2</span> : null}
    </span>
  );
}

function platformTone(platform: string): string {
  if (["switch", "switch2", "nes", "snes", "n64", "gamecube", "wii", "wiiu", "gb", "gbc", "gba", "ds", "3ds"].includes(platform)) return "border-[#ff4554]/30 bg-[#ff4554]/10 text-[#ff6975]";
  if (platform.startsWith("ps") || platform === "vita") return "border-[#67a8ff]/30 bg-[#67a8ff]/10 text-[#7db5ff]";
  if (["xbox", "x360", "xone"].includes(platform)) return "border-[#75d15a]/30 bg-[#75d15a]/10 text-[#86dc6d]";
  if (["sms", "genesis", "saturn", "dreamcast"].includes(platform)) return "border-[#4ecdc4]/30 bg-[#4ecdc4]/10 text-[#5fd8d0]";
  if (platform === "3do") return "border-warn/30 bg-warn/10 text-warn";
  return "border-white/15 bg-white/5 text-nes-grey";
}
