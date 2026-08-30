"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameMap, MapMarker } from "@prisma/client";
import { KIND_LABELS, MARKER_KINDS, kindColor, type MarkerKind } from "@/lib/maps/kinds";
import { cx } from "@/components/ui";

/**
 * Pan/zoom map viewer with markers and a location list.
 *
 * The world is one absolutely-positioned layer carrying `translate(tx,ty)
 * scale(s)`; the image sits at the origin and every marker is
 * `translate(x,y) scale(1/s)` so it stays a constant screen size. Pointer
 * events do both drag and pinch; wheel zooms about the cursor.
 *
 * Things learned the hard way while prototyping, kept here on purpose:
 *  - `overflow: clip`, not `hidden` — hidden containers can still be scrolled
 *    programmatically (focus, scrollIntoView) and that shifts the whole scene.
 *  - Never capture the pointer when it goes down on a button; capture redirects
 *    the click to the container and the marker never hears it.
 *  - The markers layer must be anchored at the world origin, or it lands below
 *    the image in normal flow and every marker is one map-height too low.
 *  - `max-width: none` on the image: a global img reset squashes a 4096px map.
 */

type Props = { gameId: string; gameName: string; maps: (GameMap & { markers: MapMarker[] })[] };

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
/** Zoom to at least this when flying to a marker: native pixels ×0.8 reads the tiles without fuzz. */
const FLY_SCALE = 0.8;
/** Below this, marker labels are hidden so a fit view is not a wall of text. */
const LABEL_SCALE = 0.45;
const PHONE = 720;

export function MapViewer({ gameId, gameName, maps }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const active = maps.find((m) => m.slug === search.get("m")) ?? maps[0];
  // Selection is scoped to a map, so switching maps drops it without an effect.
  const [sel, setSel] = useState<{ map: string; id: string } | null>(null);
  const selected = sel && sel.map === active?.id ? sel.id : null;
  const setSelected = useCallback((id: string | null) => setSel(id && active ? { map: active.id, id } : null), [active]);
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(MARKER_KINDS));
  const [sheet, setSheet] = useState<"short" | "mid" | "tall">("mid");
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // View state lives in refs and is written straight to the DOM: a pan at 60fps
  // through React state would re-render every marker on every frame.
  const view = useRef({ s: 0.2, tx: 0, ty: 0 });
  const [scale, setScale] = useState(0.2);

  const W = active?.width || 1024;
  const H = active?.height || 1024;

  const apply = useCallback(() => {
    const { s, tx, ty } = view.current;
    const world = worldRef.current;
    if (!world) return;
    world.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    world.style.setProperty("--inv", `${1 / s}`);
    setScale(s);
  }, []);

  const fit = useCallback(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const pad = 64; // room for the map switcher along the bottom
    const s = Math.min(r.width / W, (r.height - pad) / H);
    view.current = { s, tx: (r.width - W * s) / 2, ty: (r.height - pad - H * s) / 2 };
    apply();
  }, [W, H, apply]);

  const zoomAt = useCallback(
    (f: number, cx: number, cy: number) => {
      const v = view.current;
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.s * f));
      view.current = { s: ns, tx: cx - (cx - v.tx) * (ns / v.s), ty: cy - (cy - v.ty) * (ns / v.s) };
      apply();
    },
    [apply],
  );

  const flyTo = useCallback(
    (m: MapMarker) => {
      const vp = vpRef.current;
      if (!vp) return;
      const r = vp.getBoundingClientRect();
      const ns = Math.max(view.current.s, FLY_SCALE);
      const goal = { s: ns, tx: r.width / 2 - m.x * ns, ty: r.height / 2 - m.y * ns };
      const from = { ...view.current };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const dur = reduce ? 0 : 450;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = dur ? Math.min(1, (t - t0) / dur) : 1;
        const e = 1 - Math.pow(1 - k, 3);
        view.current = { s: from.s + (goal.s - from.s) * e, tx: from.tx + (goal.tx - from.tx) * e, ty: from.ty + (goal.ty - from.ty) * e };
        apply();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [apply],
  );

  // Fit on mount, on map change, and when the viewport resizes.
  useEffect(() => {
    fit();
    const vp = vpRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(fit);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fit, active?.id]);

  // Pointer pan + pinch. Not attached through React so `wheel` can be non-passive.
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const pts = new Map<number, { x: number; y: number }>();
    let last: { x: number; y: number; d?: number; cx?: number; cy?: number } | null = null;
    let moved = false;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, a")) return;
      vp.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      last = null;
      vp.classList.add("cursor-grabbing");
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const P = [...pts.values()];
      const r = vp.getBoundingClientRect();
      if (P.length === 1) {
        if (last) {
          const dx = P[0].x - last.x;
          const dy = P[0].y - last.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          view.current.tx += dx;
          view.current.ty += dy;
          apply();
        }
        last = { x: P[0].x, y: P[0].y };
      } else if (P.length >= 2) {
        const cx = (P[0].x + P[1].x) / 2 - r.left;
        const cy = (P[0].y + P[1].y) / 2 - r.top;
        const d = Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y);
        if (last?.d && last.cx != null && last.cy != null) {
          zoomAt(d / last.d, cx, cy);
          view.current.tx += cx - last.cx;
          view.current.ty += cy - last.cy;
          apply();
        }
        last = { x: 0, y: 0, d, cx, cy };
        moved = true;
      }
    };
    const up = (e: PointerEvent) => {
      const had = pts.delete(e.pointerId);
      last = null;
      vp.classList.remove("cursor-grabbing");
      // A plain tap on the ground clears the selection.
      if (had && pts.size === 0 && !moved && !(e.target as HTMLElement).closest("button, a")) setSelected(null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    const scroll = () => {
      vp.scrollTop = 0;
      vp.scrollLeft = 0;
    };
    vp.addEventListener("pointerdown", down);
    vp.addEventListener("pointermove", move);
    vp.addEventListener("pointerup", up);
    vp.addEventListener("pointercancel", up);
    vp.addEventListener("wheel", wheel, { passive: false });
    vp.addEventListener("scroll", scroll);
    return () => {
      vp.removeEventListener("pointerdown", down);
      vp.removeEventListener("pointermove", move);
      vp.removeEventListener("pointerup", up);
      vp.removeEventListener("pointercancel", up);
      vp.removeEventListener("wheel", wheel);
      vp.removeEventListener("scroll", scroll);
    };
  }, [apply, zoomAt, setSelected]);

  const visible = useMemo(() => (active?.markers ?? []).filter((m) => kinds.has(m.kind)), [active, kinds]);
  const selectedMarker = visible.find((m) => m.id === selected) ?? null;
  const presentKinds = useMemo(() => MARKER_KINDS.filter((k) => active?.markers.some((m) => m.kind === k)), [active]);

  function pick(m: MapMarker, from: "map" | "list") {
    setSelected(m.id);
    if (from === "list") {
      flyTo(m);
      if (window.innerWidth <= PHONE) setSheet("short");
    } else {
      listRef.current?.querySelector<HTMLElement>(`[data-marker="${m.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function switchMap(slug: string) {
    router.replace(`/game/${gameId}/map?m=${encodeURIComponent(slug)}`, { scroll: false });
  }

  if (!active) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted">No maps for {gameName} yet.</p>
        <Link href={`/game/${gameId}`} className="text-sm text-accent hover:underline">
          ◂ Back to the game
        </Link>
      </div>
    );
  }

  const zoomCenter = (f: number) => {
    const r = vpRef.current?.getBoundingClientRect();
    if (r) zoomAt(f, r.width / 2, r.height / 2);
  };

  return (
    <div className="fixed inset-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-bg text-text md:grid-cols-[minmax(0,1fr)_320px] md:grid-rows-1" data-testid="map-viewer">
      {/* Map */}
      <div ref={vpRef} className={cx("relative cursor-grab touch-none select-none", "[overflow:clip]")} style={{ background: "#0d1a3a" }} data-testid="map-viewport">
        <div ref={worldRef} className="absolute left-0 top-0 origin-top-left" style={{ width: W, height: H }}>
          {active.width ? (
            <img src={`/api/maps/${active.id}/image`} alt={`${gameName} — ${active.title}`} width={W} height={H} draggable={false} className="block [image-rendering:pixelated] [max-width:none] [max-height:none]" style={{ width: W, height: H }} />
          ) : (
            <div className="flex items-center justify-center text-sm text-faint" style={{ width: W, height: H }}>
              No image uploaded yet
            </div>
          )}
          <div className="absolute left-0 top-0">
            {visible.map((m) => {
              const on = m.id === selected;
              return (
                <div key={m.id} className="absolute left-0 top-0 h-0 w-0 origin-top-left" style={{ transform: `translate(${m.x}px,${m.y}px) scale(var(--inv, 1))` }}>
                  <button
                    onClick={() => pick(m, "map")}
                    aria-label={m.name}
                    aria-pressed={on}
                    data-testid="map-marker"
                    className={cx("absolute -left-3.5 -top-3.5 h-7 w-7 rounded-full border-[3px] border-white shadow-[0_2px_6px_rgba(0,0,0,.5)] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", on && "scale-[1.4] border-accent shadow-[0_0_0_6px_rgba(230,207,136,.35),0_2px_8px_rgba(0,0,0,.6)]")}
                    style={{ background: kindColor(m.kind) }}
                  />
                  <span className={cx("pointer-events-none absolute left-[18px] -top-2.5 whitespace-nowrap text-[13px] font-semibold leading-none text-white [text-shadow:0_1px_0_#000,0_0_4px_#000] transition-opacity", scale > LABEL_SCALE || on ? "opacity-100" : "opacity-0")}>{m.name}</span>
                </div>
              );
            })}
          </div>
          {selectedMarker ? (
            <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${selectedMarker.x}px,${selectedMarker.y}px) scale(var(--inv, 1)) translate(-50%, calc(-100% - 26px))` }}>
              <div className="w-max max-w-[260px] rounded-lg border border-border bg-surface px-3 py-2.5 text-text shadow-[0_8px_24px_rgba(0,0,0,.4)]" data-testid="map-popup">
                <div className="font-display text-base font-bold">{selectedMarker.name}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted">
                  {KIND_LABELS[selectedMarker.kind as MarkerKind] ?? selectedMarker.kind}
                  {selectedMarker.note ? ` · ${selectedMarker.note}` : ""}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* HUD */}
        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          <HudButton label="Zoom in" onClick={() => zoomCenter(1.5)}>
            +
          </HudButton>
          <HudButton label="Zoom out" onClick={() => zoomCenter(1 / 1.5)}>
            −
          </HudButton>
          <HudButton label="Fit map" onClick={fit}>
            <span className="text-[11px] font-bold">fit</span>
          </HudButton>
        </div>
        <div className="pointer-events-none absolute right-3 top-3 text-right">
          <Link href={`/game/${gameId}`} className="pointer-events-auto inline-flex min-h-8 items-center rounded-full bg-black/55 px-3 text-xs text-white/90 backdrop-blur hover:bg-black/70" data-testid="map-back">
            ◂ {gameName}
          </Link>
          <div className="mt-1 text-[11px] font-medium uppercase tracking-[.12em] text-white/80 [text-shadow:0_1px_2px_#000]">
            {active.title}
            {active.subtitle ? ` · ${active.subtitle}` : ""}
          </div>
        </div>
        {maps.length > 1 ? (
          <div className="absolute bottom-3.5 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/60 p-1" data-testid="map-tabs">
            {maps.map((m) => (
              <button key={m.id} onClick={() => switchMap(m.slug)} className={cx("min-h-8 rounded-full px-3.5 font-display text-sm font-bold text-white", m.id === active.id && "bg-accent text-accent-ink")} aria-current={m.id === active.id ? "page" : undefined}>
                {m.title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* List — side panel on desktop, bottom sheet on phones */}
      <aside className={cx("flex min-h-0 min-w-0 flex-col border-border bg-surface transition-[height] max-md:rounded-t-2xl max-md:border-t md:border-l", sheet === "tall" && "max-md:h-[78dvh]", sheet === "mid" && "max-md:h-[42dvh]", sheet === "short" && "max-md:h-[112px]")} data-testid="map-list">
        <button
          className="mx-auto mt-2 h-5 w-16 shrink-0 md:hidden"
          aria-label={sheet === "tall" ? "Collapse list" : "Expand list"}
          onClick={() => setSheet((s) => (s === "short" ? "mid" : s === "mid" ? "tall" : "short"))}
        >
          <span className="mx-auto block h-1.5 w-11 rounded-full bg-border" />
        </button>
        <header className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
          <h2 className="font-display text-lg font-bold">Locations</h2>
          <span className="text-xs uppercase tracking-[.1em] text-muted">
            {visible.length} of {active.markers.length}
          </span>
        </header>
        {presentKinds.length > 1 ? (
          <div className="flex gap-1.5 overflow-x-auto border-b border-border px-4 py-2 [scrollbar-width:none]">
            {presentKinds.map((k) => {
              const on = kinds.has(k);
              return (
                <button
                  key={k}
                  onClick={() =>
                    setKinds((prev) => {
                      const next = new Set(prev);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      return next;
                    })
                  }
                  className={cx("flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition", on ? "border-muted bg-surface-2 text-text" : "border-border text-faint opacity-60")}
                  aria-pressed={on}
                >
                  <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: kindColor(k) }} />
                  {KIND_LABELS[k]}
                </button>
              );
            })}
          </div>
        ) : null}
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5" data-testid="map-locations">
          {visible.map((m) => (
            <li key={m.id} data-marker={m.id} className={cx(m.id === selected && "bg-surface-2 shadow-[inset_3px_0_0_var(--accent)]")}>
              <button onClick={() => pick(m, "list")} className="grid w-full grid-cols-[14px_1fr] items-start gap-2.5 px-4 py-2.5 text-left hover:bg-surface-2" data-testid="map-location">
                <i className="mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]" style={{ background: kindColor(m.kind) }} />
                <span>
                  <b className="block text-sm font-semibold">{m.name}</b>
                  {m.note ? <small className="mt-0.5 block text-xs leading-snug text-muted">{m.note}</small> : null}
                </span>
              </button>
            </li>
          ))}
          {!visible.length ? <li className="px-4 py-6 text-center text-sm text-faint">{active.markers.length ? "Everything is filtered out." : "No locations marked yet."}</li> : null}
        </ul>
        {active.sourceUrl ? (
          <a href={active.sourceUrl} target="_blank" rel="noreferrer" className="border-t border-border px-4 py-2 text-[11px] text-faint hover:text-muted max-md:hidden">
            Map source ↗
          </a>
        ) : null}
      </aside>
    </div>
  );
}

function HudButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface font-display text-xl font-bold text-text shadow">
      {children}
    </button>
  );
}
