"use client";

import { useState } from "react";
import { Badge, cx } from "@/components/ui";
import { minutesLabel } from "@/components/shelf/players-line";
import type { Fact, PlayerProfile } from "@/lib/facts";
import type { ShelfGame } from "@/lib/collection";

/**
 * The six fact tiles, condensed into one line: what used to be a
 * `2×3`/`3×2` grid of tiles (Players, Co-op, At the same time, How long,
 * Rating, Plays like) is now the sentence a person actually reads —
 * "1–4 players · Co-op · Same screen · ~1 h" — with the same facts one tap
 * away underneath for whoever wants the provenance.
 *
 * "Plays like" is gone outright (it duplicated the tag row two lines below),
 * and Rating moved into the meta chip row in `page.tsx`. What is left here is
 * the four segments that answer "should we play this": players, co-op,
 * same-screen-or-turns, and how long it takes.
 */
export function PlayLine({ profile, playersFallback, playtimeCompletely }: { profile: PlayerProfile; playersFallback: ShelfGame["players"]; playtimeCompletely: number | null }) {
  const [open, setOpen] = useState(false);
  const { segments, inferred } = buildLine(profile, playersFallback);

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center gap-1.5 text-left text-[15px]" aria-expanded={open} aria-controls="play-line-detail" data-testid="play-line">
        <span className={cx(segments.length ? "text-text" : "text-faint")}>{segments.length ? segments.join(" · ") : "Nothing known about how it plays yet."}</span>
        {inferred ? (
          <Badge tone="info" className="shrink-0">
            inferred
          </Badge>
        ) : null}
        <span aria-hidden className={cx("ml-auto shrink-0 text-faint transition-transform", open && "rotate-90")}>
          ▸
        </span>
      </button>
      <div id="play-line-detail" hidden={!open} className="mt-2 rounded-xl border border-border bg-surface px-3" data-testid="facts">
        <FactRow label="Players" fact={profile.maxPlayers} render={(v) => (v <= 1 ? "1" : `1–${v}`)} fallback={playersFallback.tier === "mode" ? playersFallback.label : null} />
        <FactRow label="Co-op" fact={profile.coop} render={(v) => (v ? "Yes" : "No")} />
        <FactRow label="At the same time" fact={profile.simultaneousPlay} render={(v) => (v ? "Yes" : "Turns")} />
        <FactRow label="How long" fact={profile.playtimeMinutes} render={(v) => minutesLabel(v) ?? "?"} sub={playtimeCompletely ? `${minutesLabel(playtimeCompletely)} to finish everything` : null} />
      </div>
    </div>
  );
}

type Segments = { segments: string[]; inferred: boolean };

function buildLine(p: PlayerProfile, fallback: ShelfGame["players"]): Segments {
  const segments: string[] = [];
  let inferred = false;
  const noteDerived = (source: string | null) => {
    if (source === "derived") inferred = true;
  };

  const maxKnown = p.maxPlayers.value != null;
  if (maxKnown) {
    const v = p.maxPlayers.value!;
    segments.push(v <= 1 ? "1 player" : `1–${v} players`);
    noteDerived(p.maxPlayers.source);
  } else if (fallback.tier === "mode") {
    segments.push(fallback.label);
  }

  if (p.coop.value === true) {
    segments.push("Co-op");
    noteDerived(p.coop.source);
  } else if (p.coop.value === false) {
    segments.push("No co-op");
    noteDerived(p.coop.source);
  }

  // Only meaningful once we know there is more than one player — "Turns" on a
  // 1-player game is noise, not information.
  if (maxKnown && p.maxPlayers.value! > 1) {
    if (p.simultaneousPlay.value === true) {
      segments.push("Same screen");
      noteDerived(p.simultaneousPlay.source);
    } else if (p.simultaneousPlay.value === false) {
      segments.push("Turns");
      noteDerived(p.simultaneousPlay.source);
    }
  }

  if (p.playtimeMinutes.value != null) {
    const label = minutesLabel(p.playtimeMinutes.value);
    if (label) {
      segments.push(`~${label}`);
      noteDerived(p.playtimeMinutes.source);
    }
  }

  return { segments, inferred };
}

const sourceLabel: Record<string, { text: string; tone: "good" | "muted" | "info" | "warn" }> = {
  manual: { text: "verified", tone: "good" },
  agent: { text: "researched", tone: "good" },
  "igdb:multiplayer_modes": { text: "IGDB", tone: "muted" },
  "igdb:game_modes": { text: "IGDB", tone: "muted" },
  "igdb:time_to_beat": { text: "IGDB", tone: "muted" },
  derived: { text: "inferred", tone: "info" },
};

function FactRow<T extends number | boolean>({ label, fact, render, fallback, sub }: { label: string; fact: Fact<T>; render: (v: T) => string; fallback?: string | null; sub?: string | null }) {
  const known = fact.value != null;
  const src = fact.source ? sourceLabel[fact.source] : null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className={cx("text-sm font-semibold", !known && "font-normal text-faint")} title={known && "note" in fact && fact.note ? fact.note : undefined}>
          {known ? render(fact.value as T) : (fallback ?? "unknown")}
        </div>
        {sub && known ? <div className="text-[11px] text-faint">{sub}</div> : null}
      </div>
      {known && src ? (
        "sourceUrl" in fact && fact.sourceUrl ? (
          <a href={fact.sourceUrl} target="_blank" rel="noreferrer" title={fact.sourceUrl} className="shrink-0 hover:underline">
            <Badge tone={src.tone}>{src.text} ↗</Badge>
          </a>
        ) : (
          <Badge tone={src.tone} className="shrink-0">
            {src.text}
          </Badge>
        )
      ) : null}
    </div>
  );
}
