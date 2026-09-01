/**
 * The one grid every page that draws games as cover art uses: `/shelf`,
 * `/playing`, and home's "Where you left off" (GAMEEXPLOR-0026). A game looks
 * like a game everywhere, which means a card is the same width everywhere, so
 * there is one string for it rather than a copy per page that has to be kept
 * in step by hand.
 *
 * Its own module, not an export from `shelf.tsx`, because that file is
 * `"use client"`: a plain value exported across that boundary reaches a server
 * component as a client *reference*, not a string, and home's panel is a
 * server component.
 *
 * The phone column count is the one thing that varies, so it is the only thing
 * the two exports differ by — everything else is shared, and neither is
 * composed over the other (Tailwind resolves `grid-cols-2` against
 * `grid-cols-3` by stylesheet order, not by the order you wrote them).
 */
const grid = "gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-4";

/** Two covers across a phone, then as many 150px columns as fit. */
export const shelfGrid = `grid grid-cols-2 ${grid}`;

/** Three across a phone: home's panel is short and capped, and smaller cards keep more of it in one screenful. */
export const shelfGridThreeUp = `grid grid-cols-3 ${grid}`;
