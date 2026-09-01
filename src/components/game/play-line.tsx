"use client";

import { useState } from "react";
import { Badge, cx } from "@/components/ui";
import { minutesLabel } from "@/components/shelf/players-line";
import type { Fact, PlayerProfile } from "@/lib/facts";
import { PLAYER_LABELS, describePlayers } from "@/lib/players";

/**
 * The six fact tiles, condensed into one line: what used to be a
 * `2×3`/`3×2` grid of tiles (Players, Co-op, At the same time, How long,
 * Rating, Plays like) is now the sentence a person actually reads —
 * "1–4 · Local co-op · Together · ~1 h" — with the same facts one tap
 * away underneath for whoever wants the provenance.
 *
 * "Plays like" is gone outright (it duplicated the tag row two lines below),
 * and Rating moved into the meta chip row in `page.tsx`. What is left here is
 * the four things that answer "should we play this": how many players, which
 * kind of co-op, together or taking turns, and how long it takes.
 *
 * The wording is not this component's to invent — `src/lib/players.ts` owns
 * the vocabulary, so the game page and a shelf card say the same words about
 * the same game. All this adds is the breakdown underneath, one row per axis
 * with where the value came from.
 */
export function PlayLine({ profile, playtimeCompletely }: { profile: PlayerProfile; playtimeCompletely: number | null }) {
  const [open, setOpen] = useState(false);
  const players = describePlayers(profile);
  const playtime = profile.playtimeMinutes.value != null ? minutesLabel(profile.playtimeMinutes.value) : null;
  const nothingKnown = players.tier === "unknown" && !playtime;
  const segments = nothingKnown ? [] : [players.short, ...(playtime ? [`~${playtime}`] : [])];
  const inferred = players.inferred || (playtime != null && profile.playtimeMinutes.source === "derived");

  // Local co-op is one idea with two IGDB spellings — offline co-op and split
  // screen — so the row shows whichever of them actually knows something.
  const localCoop = profile.coop.value != null ? profile.coop : profile.splitscreen;

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center gap-1.5 text-left text-[15px]" aria-expanded={open} aria-controls="play-line-detail" data-testid="play-line">
        <span className={cx(segments.length ? "text-text" : "text-faint")}>{segments.length ? segments.join(" · ") : "Nothing known about how it plays yet."}</span>
        {inferred ? (
          <Badge tone="muted" className="shrink-0">
            inferred
          </Badge>
        ) : null}
        <span aria-hidden className={cx("shrink-0 text-faint transition-transform", open && "rotate-90")}>
          ▸
        </span>
      </button>
      <div id="play-line-detail" hidden={!open} className="mt-2 rounded-xl border border-border bg-surface px-3" data-testid="facts">
        <FactRow label="Players" fact={profile.maxPlayers} render={() => players.count.label ?? "?"} />
        <FactRow label="Local co-op" fact={localCoop} render={(v) => (v ? "Yes" : "No")} sub="Couch, same console, split screen" />
        <FactRow label="Online co-op" fact={profile.onlineCoop} render={(v) => (v ? "Yes" : "No")} sub="Playing together from somewhere else" />
        <FactRow label="Together or taking turns" fact={profile.simultaneousPlay} render={(v) => (v ? PLAYER_LABELS.simultaneous : PLAYER_LABELS.alternating)} />
        <FactRow label="How long" fact={profile.playtimeMinutes} render={(v) => minutesLabel(v) ?? "?"} sub={playtimeCompletely ? `${minutesLabel(playtimeCompletely)} to finish everything` : null} />
      </div>
    </div>
  );
}

const sourceLabel: Record<string, { text: string; tone: "good" | "muted" | "info" | "warn" }> = {
  manual: { text: "verified", tone: "good" },
  agent: { text: "researched", tone: "good" },
  "igdb:multiplayer_modes": { text: "IGDB", tone: "muted" },
  "igdb:game_modes": { text: "IGDB", tone: "muted" },
  "igdb:time_to_beat": { text: "IGDB", tone: "muted" },
  derived: { text: "inferred", tone: "info" },
};

function FactRow<T extends number | boolean>({ label, fact, render, sub }: { label: string; fact: Fact<T>; render: (v: T) => string; sub?: string | null }) {
  const known = fact.value != null;
  const src = fact.source ? sourceLabel[fact.source] : null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className={cx("text-sm font-semibold", !known && "font-normal text-faint")} title={known && "note" in fact && fact.note ? fact.note : undefined}>
          {known ? render(fact.value as T) : "unknown"}
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
