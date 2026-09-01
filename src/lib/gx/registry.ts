import { BOOKMARK_KINDS } from "@/lib/bookmarks/kinds";
import { CODE_KINDS } from "@/lib/codes/kinds";
import { FACT_FIELDS } from "@/lib/facts";
import { MARKER_KINDS } from "@/lib/maps/kinds";

/**
 * The command table — the load-bearing artifact of the whole CLI
 * (GAMEEXPLOR-0036).
 *
 * Everything else in `src/lib/gx` is machinery that reads this file. The
 * parser learns what a command takes from here, `--help` is *printed* from
 * here rather than written by hand, and GAMEEXPLOR-0030 asserts this table
 * against `find src/app/api -name route.ts`. That last one is why `route` is
 * the literal Next path with its brackets intact — `/api/games/[id]/codes`,
 * not `/api/games/:id/codes` and not a template string built at runtime. It is
 * data that has to match a filename, so it is spelled the way the filename is.
 *
 * The point of all that indirection is a specific failure mode. The previous
 * agent interface was prose: a Markdown file listing `curl` invocations. It
 * drifted twice, because nothing anywhere could tell that a route had moved or
 * that a payload had grown a required field. Here, a route with no command is
 * a failing test and a command whose flags are wrong is a `400` with the API's
 * own message. The docs cannot go stale relative to the code because the docs
 * *are* the code.
 *
 * Two rules for anyone adding a command:
 *
 * - **`route` and `method` are facts about the server, not labels.** Copy the
 *   path from the directory tree and the verb from the exported function. If
 *   you find yourself inventing either, you are adding a command for a route
 *   that does not exist.
 * - **Summaries are the documentation.** There is no second file describing
 *   these commands, by design. A summary that says "adds a code" earns
 *   nothing; one that says which id it wants and what the API will refuse is
 *   what someone reads instead of opening the route.
 *
 * What is deliberately absent: `/api/auth/*` (a browser session, not a
 * curation endpoint), `/api/img/*` (the shelf's pixels), and the journal
 * routes. The journal has no agent write path *by design* — notes and photos
 * are prose about the owner's life, and an agent drafting one is the same
 * failure as an agent-written walkthrough, which every write path in this
 * project refuses. Its absence from `--help` is that refusal, in code; the
 * reasoning lives in "Never write these" in the `curate-collection` skill.
 *
 * `gx play` and `gx queue` were absent for the same reason until
 * GAMEEXPLOR-0031, which opened both under one rule: **record, never infer.**
 * An agent may write down a run the owner described, and may plan what to play
 * next; it may never derive a run from a habit, a journal entry or a
 * completion percentage. A command table cannot enforce that — only the agent
 * reading `reference/play.md` can — so the table's job here is the narrower
 * one it can actually do: make the legal moves obvious, and split `start` from
 * `log` so "I am playing this now" and "I played this in 1997" can never be
 * typed by accident for one another.
 */

/** How a value gets from the command line into the request. */
export type Into =
  /** Substituted for `[param]` in `route`. */
  | { kind: "path"; param: string }
  /** Appended as `?param=…`; a repeatable flag appends once per occurrence. */
  | { kind: "query"; param: string }
  /** Set as `field` on the JSON body; a repeatable flag collects into an array. */
  | { kind: "body"; field: string }
  /** The entire JSON body, for the batch endpoints. `--body -` reads stdin. */
  | { kind: "body-json" }
  /** A local file streamed as the raw request body. The CLI's only file read. */
  | { kind: "file" };

/**
 * `json` exists for the handful of fields that are genuinely polymorphic — a
 * fact's `value` is a boolean *or* an integer *or* `null`, and `igdbId` is an
 * id *or* `null` meaning "unlink". Spelling those as strings and guessing
 * would make `--value 0` and `--value false` indistinguishable, which are two
 * different facts about a game.
 */
export type ValueType = "string" | "int" | "bool" | "json";

export type Arg = {
  /** Rendered in the usage line as `<name>`. */
  name: string;
  summary: string;
  required: boolean;
  type: ValueType;
  into: Into;
};

export type Flag = {
  /** The long name without dashes, kebab-case: `source-url` → `--source-url`. */
  name: string;
  summary: string;
  type: ValueType;
  into: Into;
  /** Enforced by the parser unless the command was given a `--body`. */
  required?: boolean;
  /** May be given more than once; collects into an array. */
  repeat?: boolean;
  /** Valid values, checked before the request goes out and listed in `--help`. */
  choices?: readonly string[];
};

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Command = {
  group: string;
  name: string;
  summary: string;
  /** The literal Next route path, brackets and all. Asserted by GAMEEXPLOR-0030. */
  route: string;
  method: Method;
  args: Arg[];
  flags: Flag[];
  /** Extra paragraphs for `gx <group> <cmd> --help`. */
  detail?: string;
  /** `content-type` for a `file` upload. The image and audio routes sniff the bytes anyway; `/api/import/csv` branches on it. */
  contentType?: string;
  /** `bytes` keeps the response body raw instead of parsing it as JSON. */
  accept?: "json" | "bytes";
};

export type Group = { name: string; summary: string };

/* ------------------------------------------------------------------ builders

   Small constructors so the table below reads as a table. They add no
   behaviour — every one of them returns a plain object, and the `into` target
   is resolved here rather than at parse time so the registry a test inspects
   is the registry the parser uses. */

/** camelCase the body field a kebab-case flag writes to: `source-url` → `sourceUrl`. */
const field = (flagName: string) => flagName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** A required positional that fills a `[param]` segment of the route. */
const id = (name: string, param: string, summary: string): Arg => ({ name, summary, required: true, type: "string", into: { kind: "path", param } });

/** A positional that becomes a query parameter — only `gx games search <query>` uses it. */
const positionalQuery = (name: string, param: string, summary: string, required = false): Arg => ({ name, summary, required, type: "string", into: { kind: "query", param } });

/**
 * A required positional that becomes a JSON body field rather than a path
 * segment. Exactly one route needs it: `POST /api/queue` takes the copy's id
 * in the body, because the queue is one global list and has no `[id]` of its
 * own — but `gx queue add <ownedGameId>` should still read like every other
 * command that starts with an id.
 */
const bodyArg = (name: string, fieldName: string, summary: string): Arg => ({ name, summary, required: true, type: "string", into: { kind: "body", field: fieldName } });

/** The local file a `PUT` streams. */
const fileArg = (summary: string): Arg => ({ name: "file", summary, required: true, type: "string", into: { kind: "file" } });

/** A flag that becomes a JSON body field. */
const b = (name: string, type: ValueType, summary: string, extra: Partial<Flag> = {}): Flag => ({ name, type, summary, into: { kind: "body", field: field(name) }, ...extra });

/** A flag that becomes a query parameter. */
const q = (name: string, type: ValueType, summary: string, extra: Partial<Flag> = {}): Flag => ({ name, type, summary, into: { kind: "query", param: field(name) }, ...extra });

/** The whole-body escape hatch for the batch endpoints. */
const BODY = (summary: string, extra: Partial<Flag> = {}): Flag => ({ name: "body", type: "json", summary: `${summary} Use \`--body -\` to read the JSON from stdin.`, into: { kind: "body-json" }, ...extra });

/** The paging pair every `gaps` listing shares. */
const LIMIT = q("limit", "int", "How many rows to return (1–500, default 50).");
const OFFSET = q("offset", "int", "Skip this many rows — page through a long gaps list.");

/** The id of an owned copy. Spelled out because it is the id nearly every command wants. */
const OWNED = (summary = "The owned copy — `ownedGameId` from `gx games search`, not a title and not an IGDB id.") => id("ownedGameId", "id", summary);

/* -------------------------------------------------------------------- groups */

export const GROUPS: Group[] = [
  { name: "games", summary: "The owned copies themselves: search the shelf, read one, correct it, remove it." },
  { name: "facts", summary: "Player counts, co-op kinds, simultaneous play, playtime — cited, one field at a time." },
  { name: "tags", summary: "Genre-ish labels on top of IGDB's: add, hide, list what is already in use." },
  { name: "codes", summary: "Passwords, cheats, Game Genie and Action Replay codes, per owned copy." },
  { name: "maps", summary: "Interactive maps: the image, and markers in that image's pixel coordinates." },
  { name: "bookmarks", summary: "Reference links — guide, wiki, video, longplay, article — each with a required `why`." },
  { name: "manuals", summary: "Scanned manuals: the manual, its pages in reading order, and each page's image." },
  { name: "series", summary: "Ordered lists of catalog games: seed from IGDB, prune by hand, then save." },
  { name: "import", summary: "The staged import — the only way a new game reaches the shelf, and one undoable batch." },
  { name: "enrichment", summary: "Runs: the unit of work a batch of cited facts and tags is written inside." },
  { name: "music", summary: "The owner's own soundtrack files, registered against an owned copy. Never sourced, only registered." },
  { name: "play", summary: "Runs the owner actually played: start one, finish it, write down one that already happened." },
  { name: "queue", summary: 'The one ordered "up next" list: add a game, set the order, take one back out.' },
];

/* ------------------------------------------------------------------ commands */

export const COMMANDS: Command[] = [
  /* -- games ---------------------------------------------------------------
     `search` is the front door of the whole CLI: every other group wants an
     `ownedGameId` and this is the only route that turns a name into one. */
  {
    group: "games",
    name: "search",
    summary: "Search the shelf by title and platform. This is how a name becomes an ownedGameId.",
    route: "/api/games",
    method: "GET",
    args: [positionalQuery("query", "q", "Title words, in any order: `sonic 2` finds \"Sonic the Hedgehog 2\". `sonic2` splits too, but a two-letter abbreviation like `t2` does not and will match nothing. A query with no letters or digits at all is a 400, not an empty list. Omit to list the shelf.")],
    flags: [
      q("platform", "string", "Platform slug or alias (`nes`, `Super Nintendo`). An unknown console is a 400, not an empty list.", { repeat: true }),
      q("limit", "int", "Rows per page, 1–200 (default 50)."),
      q("cursor", "string", "`nextCursor` from the previous page, verbatim."),
    ],
    detail: "Every row carries both ids: `ownedGameId` for anything hung off a copy (codes, facts, maps…), `igdbId` for series entries, which list games rather than copies.",
  },
  {
    group: "games",
    name: "show",
    summary: "One owned copy, with a count of each sub-resource already on it.",
    route: "/api/games/[id]",
    method: "GET",
    args: [OWNED()],
    detail: "Read this before researching anything: `counts` says what the copy already has, and research nobody needed is the most expensive thing you can do here.",
    flags: [],
  },
  {
    group: "games",
    name: "update",
    summary: "Correct what an import got wrong: platform, quantity, condition, or the catalog link.",
    route: "/api/games/[id]",
    method: "PATCH",
    args: [OWNED()],
    flags: [
      b("platform", "string", "Platform slug or alias to move the copy to."),
      b("quantity", "int", "How many copies of this exact thing are on the shelf (1–999)."),
      b("condition", "string", "Free text; an empty string clears it."),
      b("igdb-id", "json", "IGDB game id to re-link to — re-runs the catalog sync, art and all. `null` unlinks."),
    ],
    detail: "There is no title field: a title is the shelf's dedupe key, so the honest fix for a wrong one is to import the right row and delete this one. A 409 means that title already exists on that platform — raise the other copy's quantity instead.",
  },
  {
    group: "games",
    name: "remove",
    summary: "Delete an owned copy, everything hung off it, and its files on disk. No undo.",
    route: "/api/games/[id]",
    method: "DELETE",
    args: [OWNED()],
    detail: "The one write in this API with nothing behind it: an import has a batch to roll back, a fact has precedence, a code can be re-added. Ask the owner first, and say what `gx games show` reported as the counts. A 409 means a run is in progress.",
    flags: [],
  },

  /* -- facts ---------------------------------------------------------------
     Two write paths that look alike and mean opposite things: `facts write`
     goes through a run and lands as `source: "agent"`; `facts set` writes a
     `manual` fact, which is the owner's own hand-entry and outranks everything.
     The summaries have to carry that difference, because the routes will not. */
  {
    group: "facts",
    name: "gaps",
    summary: "Games missing player facts, with what IGDB already knows so you do not re-research it.",
    route: "/api/enrichment/gaps",
    method: "GET",
    args: [],
    flags: [q("fields", "string", `Comma-separated fields to look for gaps in. Default: maxPlayers, simultaneousPlay, coop. Any of: ${FACT_FIELDS.join(", ")}.`), LIMIT, OFFSET],
    detail: "Each row's `known` is what is already resolved — `known.multiplayer: false` means the game is single player and `maxPlayers` follows by derivation. Skip those.",
  },
  {
    group: "facts",
    name: "list",
    summary: "The stored facts on one copy, with their source and citation.",
    route: "/api/games/[id]/facts",
    method: "GET",
    args: [OWNED()],
    flags: [],
  },
  {
    group: "facts",
    name: "write",
    summary: "Write a batch of cited facts inside a run. This is the agent path.",
    route: "/api/enrichment/runs/[id]/facts",
    method: "POST",
    args: [id("runId", "id", "A run id from `gx enrichment start`.")],
    flags: [BODY('`{ "facts": [{ ownedGameId, field, value, sourceUrl, note? }] }`. Every fact needs a sourceUrl the owner could open.', { required: true })],
    detail: "Partial success is normal: read `skipped`, whose reasons are \"no sourceUrl — agent facts must cite a source\", \"owned game not found\" and \"set by hand; agents never overwrite manual facts\".",
  },
  {
    group: "facts",
    name: "set",
    summary: "Write ONE fact as the owner's own hand-entry (source: manual). Not the agent path.",
    route: "/api/games/[id]/facts",
    method: "PUT",
    args: [OWNED()],
    flags: [
      b("field", "string", "Which fact.", { required: true, choices: FACT_FIELDS }),
      b("value", "json", "`true`, `false`, an integer, or `null` to clear the fact.", { required: true }),
      b("note", "string", "Why, in one line."),
    ],
    detail:
      "This endpoint writes a `manual` fact, which nothing — not IGDB sync, not an agent run — may ever overwrite. It is the owner's hand-entry path. Using it for research would dress a citation up as an unoverridable value the owner never entered; use `gx facts write` inside a run instead, even for a single game.",
  },

  /* -- tags ---------------------------------------------------------------- */
  {
    group: "tags",
    name: "list",
    summary: "Every tag in use across the shelf, with counts. Read it before inventing a spelling.",
    route: "/api/tags",
    method: "GET",
    args: [],
    flags: [],
  },
  {
    group: "tags",
    name: "on",
    summary: "The tags on one copy: manual, agent, IGDB's, and which are hidden.",
    route: "/api/games/[id]/tags",
    method: "GET",
    args: [OWNED()],
    flags: [],
  },
  {
    group: "tags",
    name: "write",
    summary: "Write a batch of cited tags inside a run. This is the agent path.",
    route: "/api/enrichment/runs/[id]/tags",
    method: "POST",
    args: [id("runId", "id", "A run id from `gx enrichment start`.")],
    flags: [BODY('`{ "tags": [{ ownedGameId, tag, sourceUrl, note? }] }`. Every tag needs a source that uses the word.', { required: true })],
  },
  {
    group: "tags",
    name: "add",
    summary: "Add ONE hand-set tag to a copy, or un-hide an IGDB tag with --igdb.",
    route: "/api/games/[id]/tags",
    method: "PUT",
    args: [OWNED()],
    flags: [b("tag", "string", "The tag, in the spelling `gx tags list` already uses.", { required: true }), b("note", "string", "Why this tag is on this game."), b("igdb", "bool", "Treat the tag as one of IGDB's and un-hide it, rather than adding a new one.")],
    detail: "A tag written here is `manual` — the owner's own — and an agent tag with the same key will be skipped rather than overwrite it. Research goes through `gx tags write` inside a run.",
  },
  {
    group: "tags",
    name: "remove",
    summary: "Remove a manual or agent tag from a copy, or hide an IGDB one with --igdb.",
    route: "/api/games/[id]/tags",
    method: "DELETE",
    args: [OWNED()],
    flags: [b("tag", "string", "The tag to remove.", { required: true }), b("igdb", "bool", "Hide an IGDB tag instead of deleting a written one. IGDB tags are hidden, never deleted.")],
  },

  /* -- codes --------------------------------------------------------------- */
  {
    group: "codes",
    name: "gaps",
    summary: "Copies with no codes, or none of a given kind. `have` says what is already there.",
    route: "/api/codes/gaps",
    method: "GET",
    args: [],
    flags: [q("kinds", "string", `Comma-separated kinds to count as "has some": ${CODE_KINDS.join(", ")}.`), LIMIT, OFFSET],
  },
  {
    group: "codes",
    name: "list",
    summary: "Every code on one copy.",
    route: "/api/games/[id]/codes",
    method: "GET",
    args: [OWNED()],
    flags: [],
  },
  {
    group: "codes",
    name: "add",
    summary: "Add ONE code to one copy.",
    route: "/api/games/[id]/codes",
    method: "POST",
    args: [OWNED("The owned copy. Codes are per copy: the NES and SNES Game Genie codes for one game genuinely differ.")],
    flags: [
      b("kind", "string", "Which kind of code.", { required: true, choices: CODE_KINDS }),
      b("effect", "string", 'What it does, as you would say it aloud: "Infinite lives", "Start on stage 5".', { required: true }),
      b("code", "string", "The code itself, exactly as it is entered. Leave it out when the button sequence is the code."),
      b("how-to", "string", "Where and how to enter it, when that is not obvious."),
      b("source-url", "string", "Where you found it. Months later this is the only way to tell a good code from a typo."),
      b("note", "string", "Revision it works on, side effects, which cheat device."),
      b("verified", "bool", 'Leave this off. It means "tried on hardware", and you have not tried it.'),
      b("position", "int", "Display order within its kind."),
    ],
  },
  {
    group: "codes",
    name: "write",
    summary: "Write codes across many copies in one call — the research batch path.",
    route: "/api/codes",
    method: "POST",
    args: [],
    flags: [BODY('`{ "codes": [{ ownedGameId, kind, effect, code?, howTo?, sourceUrl?, note? }] }`, up to 500.', { required: true })],
    detail: 'Partial success is normal: a bad entry is skipped with a reason ("unknown kind", "owned game not found", "already at the 30-code limit") and the rest still land.',
  },
  {
    group: "codes",
    name: "update",
    summary: "Edit one code, or tick `verified` after trying it on hardware.",
    route: "/api/games/[id]/codes/[codeId]",
    method: "PATCH",
    args: [OWNED(), id("codeId", "codeId", "The code's id, from `gx codes list`.")],
    flags: [
      b("kind", "string", "Move it to another kind.", { choices: CODE_KINDS }),
      b("effect", "string", "What it does."),
      b("code", "string", "The code itself; an empty string clears it."),
      b("how-to", "string", "How to enter it; an empty string clears it."),
      b("source-url", "string", "Where it came from; an empty string clears it."),
      b("note", "string", "Anything else; an empty string clears it."),
      b("verified", "bool", "Tried on hardware and it works."),
      b("position", "int", "Display order within its kind."),
    ],
  },
  {
    group: "codes",
    name: "remove",
    summary: "Delete one code from one copy.",
    route: "/api/games/[id]/codes/[codeId]",
    method: "DELETE",
    args: [OWNED(), id("codeId", "codeId", "The code's id, from `gx codes list`.")],
    flags: [],
  },

  /* -- maps ----------------------------------------------------------------
     A map is one image plus markers in that image's pixel coordinates, so the
     order is always: create the row, upload the bytes (which records
     width/height), then write markers that the server can bounds-check. */
  {
    group: "maps",
    name: "gaps",
    summary: "Copies with no map yet.",
    route: "/api/maps/gaps",
    method: "GET",
    args: [],
    flags: [LIMIT, OFFSET],
  },
  {
    group: "maps",
    name: "list",
    summary: "One copy's maps, each with its markers.",
    route: "/api/games/[id]/maps",
    method: "GET",
    args: [OWNED()],
    flags: [],
  },
  {
    group: "maps",
    name: "create",
    summary: "Create a map row on a copy. Re-posting the same slug refreshes it in place.",
    route: "/api/games/[id]/maps",
    method: "POST",
    args: [OWNED()],
    flags: [
      b("title", "string", 'Short: "Overworld", "Dark World", "World 1".', { required: true }),
      b("subtitle", "string", 'Optional flavour: "Blue Planet", "Lunar surface".'),
      b("slug", "string", "Stable handle, lowercase and hyphens. Defaults to the slugified title."),
      b("source-url", "string", "The page the image came from."),
      b("note", "string", "Anything worth knowing about this map."),
      b("position", "int", "Display order among the copy's maps (0 first)."),
    ],
    detail: "Width and height stay 0 until `gx maps upload` puts an image on the row, and markers are bounds-checked against those numbers — so upload the image before writing markers.",
  },
  {
    group: "maps",
    name: "show",
    summary: "One map with its markers.",
    route: "/api/maps/[mapId]",
    method: "GET",
    args: [id("mapId", "mapId", "The map's id, from `gx maps list` or `gx maps create`.")],
    flags: [],
  },
  {
    group: "maps",
    name: "update",
    summary: "Edit a map's title, subtitle, slug, source or position.",
    route: "/api/maps/[mapId]",
    method: "PATCH",
    args: [id("mapId", "mapId", "The map's id.")],
    flags: [b("title", "string", "Short title."), b("subtitle", "string", "Optional flavour line."), b("slug", "string", "Stable handle used in `/game/<id>/map?m=<slug>`."), b("source-url", "string", "Where the image came from."), b("note", "string", "Anything worth knowing."), b("position", "int", "Display order among the copy's maps.")],
  },
  {
    group: "maps",
    name: "remove",
    summary: "Delete a map, its markers and its image file.",
    route: "/api/maps/[mapId]",
    method: "DELETE",
    args: [id("mapId", "mapId", "The map's id.")],
    flags: [],
  },
  {
    group: "maps",
    name: "upload",
    summary: "Upload a map's image bytes (PNG or JPEG, ≤ 16 MB). Records width and height.",
    route: "/api/maps/[mapId]/image",
    method: "PUT",
    args: [id("mapId", "mapId", "The map's id."), fileArg("A local PNG or JPEG. Crop off credit panels first — every marker coordinate is relative to the image you upload.")],
    contentType: "application/octet-stream",
    flags: [],
    detail: "The server sniffs the bytes rather than trusting a header, so the content type sent here does not matter; anything that is not a PNG or JPEG comes back 415.",
  },
  {
    group: "maps",
    name: "image",
    summary: "Read a map's stored image back. Prints a summary; --raw writes the bytes to stdout.",
    route: "/api/maps/[mapId]/image",
    method: "GET",
    args: [id("mapId", "mapId", "The map's id.")],
    accept: "bytes",
    flags: [],
    detail: "Mostly here for completeness and for checking that an upload landed: `gx maps image <id>` says the type and size without dumping a megabyte into your terminal. Pipe `--raw` to a file if you want the picture.",
  },
  {
    group: "maps",
    name: "markers",
    summary: "Write a map's markers — upsert by name; `replace` drops the ones not listed.",
    route: "/api/maps/[mapId]/markers",
    method: "POST",
    args: [id("mapId", "mapId", "The map's id.")],
    flags: [
      BODY(`\`{ "markers": [{ name, kind, x, y, note?, sourceUrl? }], "replace"?: true }\`, up to 300. Kinds: ${MARKER_KINDS.join(", ")}.`, { required: true }),
      b("replace", "bool", "Drop every marker not in this batch. Use it when you re-derived the whole map from a fresh read of the image; leave it off when adding a few to someone else's map."),
    ],
    detail: 'Coordinates are integer pixels of the uploaded image and are bounds-checked against it. `skipped` reasons: "unknown kind", "(x, y) is outside the W×H image", "named twice in this batch", "already at the 300-marker limit".',
  },
  {
    group: "maps",
    name: "marker-update",
    summary: "Edit one marker's name, kind, coordinates or note.",
    route: "/api/maps/[mapId]/markers/[markerId]",
    method: "PATCH",
    args: [id("mapId", "mapId", "The map's id."), id("markerId", "markerId", "The marker's id, from `gx maps show`.")],
    flags: [b("name", "string", "As the game names the place."), b("kind", "string", "Marker kind.", { choices: MARKER_KINDS }), b("x", "int", "Pixel x in the uploaded image."), b("y", "int", "Pixel y in the uploaded image."), b("note", "string", "One line: what you do or find there."), b("source-url", "string", "Only when the note came from somewhere specific."), b("position", "int", "Order in the marker list.")],
  },
  {
    group: "maps",
    name: "marker-remove",
    summary: "Delete one marker from a map.",
    route: "/api/maps/[mapId]/markers/[markerId]",
    method: "DELETE",
    args: [id("mapId", "mapId", "The map's id."), id("markerId", "markerId", "The marker's id.")],
    flags: [],
  },

  /* -- bookmarks ----------------------------------------------------------- */
  {
    group: "bookmarks",
    name: "gaps",
    summary: "Copies with no reference links, or none of a given kind.",
    route: "/api/bookmarks/gaps",
    method: "GET",
    args: [],
    flags: [q("kinds", "string", `Comma-separated kinds to count as "has some": ${BOOKMARK_KINDS.join(", ")}.`), LIMIT, OFFSET],
  },
  {
    group: "bookmarks",
    name: "list",
    summary: "One copy's reference links.",
    route: "/api/games/[id]/bookmarks",
    method: "GET",
    args: [OWNED()],
    flags: [],
  },
  {
    group: "bookmarks",
    name: "add",
    summary: "Add ONE reference link to one copy.",
    route: "/api/games/[id]/bookmarks",
    method: "POST",
    args: [OWNED()],
    flags: [
      b("kind", "string", "What you would open it for.", { required: true, choices: BOOKMARK_KINDS }),
      b("url", "string", "The page itself — http/https only, and the page, not a search result.", { required: true }),
      b("title", "string", 'What the page calls itself, author included: "Contra — FAQ/Walkthrough by CyricZ".', { required: true }),
      b("why", "string", "One line: what makes this the link to open rather than the other nine hits. Required, and the entire point of the table.", { required: true }),
      b("note", "string", "Paywalled after a few reads, covers the Japanese version too, has chapter markers."),
      b("position", "int", "Display order within its kind."),
    ],
    detail: "Verify the link resolves before writing it. A dead URL is worse than no bookmark, because it looks like one that works. And the bookmark is its own citation — there is no sourceUrl here, and you never write the guide, you link it.",
  },
  {
    group: "bookmarks",
    name: "write",
    summary: "Write links across many copies in one call — the research batch path.",
    route: "/api/bookmarks",
    method: "POST",
    args: [],
    flags: [BODY('`{ "bookmarks": [{ ownedGameId, kind, url, title, why, note? }] }`, up to 500.', { required: true })],
    detail: "Only three failures are per-row skips (unknown kind, owned game not found, at the 50-link limit). A malformed url or a missing `why` fails schema validation and the whole batch is rejected with 400 — check every row before sending 200 of them.",
  },
  {
    group: "bookmarks",
    name: "update",
    summary: "Edit one reference link.",
    route: "/api/bookmarks/[bookmarkId]",
    method: "PATCH",
    args: [id("bookmarkId", "bookmarkId", "The bookmark's id, from `gx bookmarks list`.")],
    flags: [b("kind", "string", "Move it to another kind.", { choices: BOOKMARK_KINDS }), b("url", "string", "The page."), b("title", "string", "What the page calls itself."), b("why", "string", "Why this is the one to open."), b("note", "string", "Anything else; an empty string clears it."), b("position", "int", "Display order within its kind.")],
  },
  {
    group: "bookmarks",
    name: "remove",
    summary: "Delete one reference link.",
    route: "/api/bookmarks/[bookmarkId]",
    method: "DELETE",
    args: [id("bookmarkId", "bookmarkId", "The bookmark's id.")],
    flags: [],
  },

  /* -- manuals -------------------------------------------------------------
     Rows first, bytes second, always: a JSON body and a multi-megabyte scan do
     not belong in one request, and a page with no image yet is a real state
     ("not scanned"), not an error. */
  {
    group: "manuals",
    name: "list",
    summary: "One copy's manuals with their pages, in reading order.",
    route: "/api/games/[id]/manuals",
    method: "GET",
    args: [OWNED()],
    flags: [],
  },
  {
    group: "manuals",
    name: "create",
    summary: "Create a manual on a copy. Up to 10 per copy.",
    route: "/api/games/[id]/manuals",
    method: "POST",
    args: [OWNED()],
    flags: [b("title", "string", 'Defaults to "Manual" — set it for a map insert or a strategy pamphlet.'), b("source-url", "string", "Where the scan came from, if it was not the owner's own."), b("note", "string", "Anything worth knowing."), b("position", "int", "Order among the copy's manuals.")],
    detail: "A manual is never upserted by content: there is no natural key, so creating one always makes a new row. If the owner is adding pages to a scan that already exists, add pages to that manual rather than making a second one.",
  },
  {
    group: "manuals",
    name: "update",
    summary: "Edit a manual's title, source, note or position.",
    route: "/api/manuals/[manualId]",
    method: "PATCH",
    args: [id("manualId", "manualId", "The manual's id, from `gx manuals list`.")],
    flags: [b("title", "string", "The manual's name."), b("source-url", "string", "Where the scan came from."), b("note", "string", "Anything worth knowing."), b("position", "int", "Order among the copy's manuals.")],
  },
  {
    group: "manuals",
    name: "remove",
    summary: "Delete a manual, every page row, and every page image.",
    route: "/api/manuals/[manualId]",
    method: "DELETE",
    args: [id("manualId", "manualId", "The manual's id.")],
    flags: [],
  },
  {
    group: "manuals",
    name: "add-page",
    summary: "Create one page row. Appends by default; --position inserts.",
    route: "/api/manuals/[manualId]/pages",
    method: "POST",
    args: [id("manualId", "manualId", "The manual's id.")],
    flags: [b("label", "string", 'What this page is: "Controls", "Item list", "Map".'), b("position", "int", "Insert here instead of appending; everything after shifts down.")],
    detail: "Positions stay dense 0..n-1, so \"page 4 of 12\" is always literally true. Add pages in reading order and appending puts them in the right sequence for free.",
  },
  {
    group: "manuals",
    name: "reorder",
    summary: "Reorder a manual's pages. A permutation: every page, exactly once.",
    route: "/api/manuals/[manualId]/pages",
    method: "PATCH",
    args: [id("manualId", "manualId", "The manual's id.")],
    flags: [b("page", "string", "A page id, in the order you want — give every page of this manual.", { repeat: true, into: { kind: "body", field: "orderedIds" } }), BODY('`{ "orderedIds": [...] }`, if you would rather send the list as JSON.')],
    detail: "A partial list is rejected with 400 rather than silently pushing the pages it forgot to the end. Read the current ids with `gx manuals list` first.",
  },
  {
    group: "manuals",
    name: "page-update",
    summary: "Rename one page of a manual.",
    route: "/api/manual-pages/[pageId]",
    method: "PATCH",
    args: [id("pageId", "pageId", "The page's id, from `gx manuals list`.")],
    flags: [b("label", "string", "The page's label; an empty string clears it.")],
  },
  {
    group: "manuals",
    name: "page-remove",
    summary: "Delete one page and its image. The rest renumber.",
    route: "/api/manual-pages/[pageId]",
    method: "DELETE",
    args: [id("pageId", "pageId", "The page's id.")],
    flags: [],
  },
  {
    group: "manuals",
    name: "upload",
    summary: "Upload one page's scan (PNG or JPEG, ≤ 16 MB). Records width and height.",
    route: "/api/manual-pages/[pageId]/image",
    method: "PUT",
    args: [id("pageId", "pageId", "The page's id."), fileArg("A local PNG or JPEG of that page.")],
    contentType: "application/octet-stream",
    flags: [],
  },
  {
    group: "manuals",
    name: "page-image",
    summary: "Read a page's stored scan back. Prints a summary; --raw writes the bytes to stdout.",
    route: "/api/manual-pages/[pageId]/image",
    method: "GET",
    args: [id("pageId", "pageId", "The page's id.")],
    accept: "bytes",
    flags: [],
  },

  /* -- series --------------------------------------------------------------
     Seed, prune, save — in that order, and never without the pruning step.
     `seen` is the part that is easy to get wrong: it must cover every id the
     preview showed, kept or not, or a rejected port comes back every time
     anyone checks. */
  {
    group: "series",
    name: "list",
    summary: "Every series as a card: name, derived cover, owned / total.",
    route: "/api/series",
    method: "GET",
    args: [],
    flags: [],
  },
  {
    group: "series",
    name: "show",
    summary: "One series with its entries resolved against the shelf and grouped into sections.",
    route: "/api/series/[seriesId]",
    method: "GET",
    args: [id("seriesId", "seriesId", "The series' id, from `gx series list`.")],
    flags: [],
  },
  {
    group: "series",
    name: "collections",
    summary: "Find an IGDB collection — by a game that is in it, or by its own id.",
    route: "/api/series/collections",
    method: "GET",
    args: [],
    flags: [q("igdb-id", "int", "An IGDB *game* id; returns every collection that game belongs to."), q("collection-id", "int", "An IGDB collection id; returns just that one.")],
    detail: 'A game is usually in several ("Final Fantasy", "Compilation of Final Fantasy VII"); pick the one that matches what "the series" means here.',
  },
  {
    group: "series",
    name: "seed-preview",
    summary: "Propose the members of an IGDB collection. Writes nothing.",
    route: "/api/series/seed-preview",
    method: "POST",
    args: [],
    flags: [b("collection-id", "int", "The IGDB collection id.", { required: true })],
    detail: "`candidates` already has ports and remakes collapsed into their primary and is marked with the owned copy where there is one. `skipped` is member ids the game_type filter refused (DLC, episodes) — report them, do not chase them.",
  },
  {
    group: "series",
    name: "create",
    summary: "Create a series from entries you have already pruned.",
    route: "/api/series",
    method: "POST",
    args: [],
    flags: [
      b("name", "string", 'The series name: "Final Fantasy".'),
      b("slug", "string", "URL handle; derived from the name when absent."),
      b("blurb", "string", "One line describing the series — not prose about any one game in it."),
      b("cover-image-id", "string", "An IGDB image id, overriding the cover derived from the first entry."),
      b("position", "int", "Display order among series."),
      b("seed-collection-id", "int", "The IGDB collection this was seeded from, so `seed-check` has something to diff against."),
      BODY('`{ name, entries: [{ igdbId | title, section?, note? }], seen: [...], seedCollectionId? }`. `entries` and `seen` can only be given this way.'),
    ],
    detail:
      "Nothing auto-publishes: preview, prune with judgement, then save what is kept. `seen` must list EVERY id the preview showed — the ones you kept and the ones you rejected, including ids collapsed into a variant. That list is the only reason a port you deliberately dropped does not reappear as \"new\" on every later check.",
  },
  {
    group: "series",
    name: "update",
    summary: "Edit the series itself: name, slug, blurb, cover, position, seed collection.",
    route: "/api/series/[seriesId]",
    method: "PATCH",
    args: [id("seriesId", "seriesId", "The series' id.")],
    flags: [b("name", "string", "The series name."), b("slug", "string", "URL handle."), b("blurb", "string", "One line describing the series."), b("cover-image-id", "string", "An IGDB image id overriding the derived cover."), b("position", "int", "Display order among series."), b("seed-collection-id", "int", "The IGDB collection to diff against.")],
    detail: "This route never touches `entries` or `seen` — those belong to the entries routes.",
  },
  {
    group: "series",
    name: "remove",
    summary: "Delete a series and every entry in it. Owned copies and catalog rows are untouched.",
    route: "/api/series/[seriesId]",
    method: "DELETE",
    args: [id("seriesId", "seriesId", "The series' id.")],
    flags: [],
  },
  {
    group: "series",
    name: "seed-check",
    summary: "What has appeared in the IGDB collection since this series was last updated.",
    route: "/api/series/[seriesId]/seed-check",
    method: "POST",
    args: [id("seriesId", "seriesId", "The series' id.")],
    flags: [],
    detail: "This diffs, it does not merge: the only write is the `seedCheckedAt` timestamp. Review `fresh`, then POST what belongs through `gx series add-entries`, passing `seen` covering everything `fresh` and `skipped` contained — kept or not.",
  },
  {
    group: "series",
    name: "add-entries",
    summary: "Add entries to a series, and/or record ids you were shown and rejected.",
    route: "/api/series/[seriesId]/entries",
    method: "POST",
    args: [id("seriesId", "seriesId", "The series' id.")],
    flags: [BODY('`{ "entries": [{ igdbId | title, section?, note? }], "seen": [...] }`. `entries` may be [] when you are only recording `seen`.', { required: true })],
    detail: "An id already in the series is reported in `skipped` (\"already in this series\"), not as a batch failure. `seen` is additive — it unions into what was recorded before and never replaces it.",
  },
  {
    group: "series",
    name: "reorder",
    summary: "Reorder a series' entries. A permutation: every entry, exactly once.",
    route: "/api/series/[seriesId]/entries",
    method: "PATCH",
    args: [id("seriesId", "seriesId", "The series' id.")],
    flags: [b("entry", "string", "An entry id, in the order you want — give every entry of this series.", { repeat: true, into: { kind: "body", field: "orderedIds" } }), BODY('`{ "orderedIds": [...] }`, if you would rather send the list as JSON.')],
  },
  {
    group: "series",
    name: "remove-entries",
    summary: "Remove several entries at once. Positions close up so they stay dense.",
    route: "/api/series/[seriesId]/entries",
    method: "DELETE",
    args: [id("seriesId", "seriesId", "The series' id.")],
    flags: [b("entry", "string", "An entry id to remove.", { repeat: true, into: { kind: "body", field: "ids" } }), BODY('`{ "ids": [...] }`, if you would rather send the list as JSON.')],
  },
  {
    group: "series",
    name: "entry-update",
    summary: "Edit one entry's title, section, note or source.",
    route: "/api/series-entries/[entryId]",
    method: "PATCH",
    args: [id("entryId", "entryId", "The entry's id, from `gx series show`.")],
    flags: [b("title", "string", "Free-text title, for an entry IGDB has no game for."), b("section", "string", 'Free-text grouping: "Mainline", "Spin-off", "Remakes".'), b("note", "string", "One line about this entry."), b("source-url", "string", "Where the claim about this entry came from.")],
    detail: "An entry's `igdbId` cannot be changed here. To fix a wrong game, remove the entry and add the right one.",
  },
  {
    group: "series",
    name: "entry-remove",
    summary: "Remove one entry from its series.",
    route: "/api/series-entries/[entryId]",
    method: "DELETE",
    args: [id("entryId", "entryId", "The entry's id.")],
    flags: [],
  },

  /* -- import --------------------------------------------------------------
     The only way a game reaches the shelf, and the reason it is staged rather
     than a POST: every commit is one batch with a rollback behind it. */
  {
    group: "import",
    name: "sessions",
    summary: "Every import session, finished or not.",
    route: "/api/import/sessions",
    method: "GET",
    args: [],
    flags: [],
  },
  {
    group: "import",
    name: "create",
    summary: "Start an import session. Rows can come now or through `gx import add-rows`.",
    route: "/api/import/sessions",
    method: "POST",
    args: [],
    flags: [
      b("label", "string", 'What this import is: "shelf photo 2026-08-28".'),
      b("source", "string", "Where the rows came from.", { choices: ["agent", "csv", "migration"] }),
      b("default-platform", "string", "Platform for rows that do not name one."),
      BODY('`{ "label": "…", "rows": [{ title, platform?, quantity?, completeness?, condition?, notes? }] }`. Rows can only be given this way.'),
    ],
  },
  {
    group: "import",
    name: "show",
    summary: "One session with every row, its decision, hold reason and ranked candidates.",
    route: "/api/import/sessions/[id]",
    method: "GET",
    args: [id("sessionId", "id", "The session id.")],
    flags: [],
  },
  {
    group: "import",
    name: "discard",
    summary: "Throw away an unfinished session. Nothing was on the shelf yet.",
    route: "/api/import/sessions/[id]",
    method: "DELETE",
    args: [id("sessionId", "id", "The session id.")],
    flags: [],
  },
  {
    group: "import",
    name: "add-rows",
    summary: "Add rows to a session and match them against IGDB. Batches of ≤ 25.",
    route: "/api/import/sessions/[id]/rows",
    method: "POST",
    args: [id("sessionId", "id", "The session id.")],
    flags: [BODY('`{ "rows": [{ title, platform?, quantity?, completeness?, condition?, notes? }] }`.', { required: true }), b("default-platform", "string", "Platform for rows in this batch that do not name one.")],
    detail: "Keep batches to about 25: IGDB is rate-limited to 4 requests a second, and a bigger batch just means a longer request.",
  },
  {
    group: "import",
    name: "decide",
    summary: "Resolve one held row: accept a candidate, drop it, or merge it.",
    route: "/api/import/sessions/[id]/rows/[rowId]",
    method: "PATCH",
    args: [id("sessionId", "id", "The session id."), id("rowId", "rowId", "The row's id, from `gx import show`.")],
    flags: [
      b("decision", "string", "What to do with the row.", { choices: ["accepted", "dropped", "merge"] }),
      b("igdb-id", "json", "The catalog game to link to, or `null` to import it unlinked. An unlinked row is honest; a wrong link puts another game's co-op tags on this cartridge."),
      b("title", "string", "Correct the title before importing."),
      b("platform", "string", "Move the row to another platform — e.g. a game IGDB only lists on SNES."),
      b("quantity", "int", "How many copies this row means."),
      b("decided-by", "string", "Who decided.", { choices: ["user", "agent"] }),
    ],
    detail: "Decide yourself only when the answer is not in doubt. Two exact matches with the same name, a best candidate under 0.8 with nothing in its reason to explain the gap, or a different game with the same words: stop and ask the owner.",
  },
  {
    group: "import",
    name: "commit",
    summary: "Commit a session — one transaction, one undoable batch.",
    route: "/api/import/sessions/[id]/commit",
    method: "POST",
    args: [id("sessionId", "id", "The session id.")],
    flags: [b("force", "bool", "Import rows still in review, unlinked. Only when the owner said so.")],
    detail: "A 409 lists the rows still in `review`. The response carries `batchId` — hand it to the owner with the report, because it is what `gx import rollback` takes.",
  },
  {
    group: "import",
    name: "batches",
    summary: "Past commits, newest first, with what each one created.",
    route: "/api/import/batches",
    method: "GET",
    args: [],
    flags: [],
  },
  {
    group: "import",
    name: "rollback",
    summary: "Undo one commit: removes exactly the rows it created, and nothing else.",
    route: "/api/import/batches/[id]/rollback",
    method: "POST",
    args: [id("batchId", "id", "The batch id from the commit response.")],
    flags: [],
  },
  {
    group: "import",
    name: "csv",
    summary: "Create a session directly from a local CSV file.",
    route: "/api/import/csv",
    method: "POST",
    args: [fileArg("A local .csv file. Sent as a raw text/csv body — the API parses the header row itself.")],
    contentType: "text/csv",
    flags: [q("label", "string", "What this import is; defaults to \"CSV import\"."), q("default-platform", "string", "Platform for rows that do not name one.")],
    detail: "Saves building rows by hand when the owner already has a spreadsheet. The response carries the session plus which columns were recognised and which rows were skipped.",
  },

  /* -- enrichment ----------------------------------------------------------
     A run is the unit a report is written about, which is why facts and tags
     are written through one rather than straight at a game. */
  {
    group: "enrichment",
    name: "runs",
    summary: "Past enrichment runs, newest first.",
    route: "/api/enrichment/runs",
    method: "GET",
    args: [],
    flags: [],
  },
  {
    group: "enrichment",
    name: "start",
    summary: "Start a run. One per session, so the report means something.",
    route: "/api/enrichment/runs",
    method: "POST",
    args: [],
    flags: [b("label", "string", 'What this pass is about: "players pass 1", "metroidvania pass".')],
  },
  {
    group: "enrichment",
    name: "show",
    summary: "One run's report: what it wrote, by field.",
    route: "/api/enrichment/runs/[id]",
    method: "GET",
    args: [id("runId", "id", "The run id.")],
    flags: [],
  },
  {
    group: "enrichment",
    name: "finish",
    summary: "Close a run and get the report to read back to the owner.",
    route: "/api/enrichment/runs/[id]/finish",
    method: "POST",
    args: [id("runId", "id", "The run id.")],
    flags: [],
  },

  /* -- music ---------------------------------------------------------------
     The one domain where an agent registers a file and never sources one.
     There is nothing to search for here: if the owner has not handed you an
     MP3, the correct outcome is to say so. */
  {
    group: "music",
    name: "list",
    summary: "A copy's playable tracks — the list the player itself reads.",
    route: "/api/games/[id]/music",
    method: "GET",
    args: [OWNED()],
    flags: [],
    detail: "Tracks whose audio was never uploaded are deliberately absent here. Use `gx music all` to find a row whose POST landed and whose PUT did not.",
  },
  {
    group: "music",
    name: "all",
    summary: "Every track row on a copy, uploaded or not, with bytes and content type.",
    route: "/api/games/[id]/music/all",
    method: "GET",
    args: [OWNED()],
    flags: [],
    detail: "A row with `bytes: 0` is the usual reason a game is unexpectedly silent. Either PUT its audio or delete it.",
  },
  {
    group: "music",
    name: "add",
    summary: "Create a track row on a copy. Up to 60 per copy.",
    route: "/api/games/[id]/music",
    method: "POST",
    args: [OWNED("The owned copy. Music is per copy: the NES and SNES versions of a title have different soundtracks.")],
    flags: [b("title", "string", 'The piece as a person reads it: "Vampire Killer", not `01_vampire_killer.mp3`. Any charset.', { required: true })],
    detail: "A track is never upserted — posting the same title twice makes two rows and the game plays both. Check `gx music all` first.",
  },
  {
    group: "music",
    name: "upload",
    summary: "Upload a track's audio (MP3, ≤ 32 MB). The bytes must be the owner's own file.",
    route: "/api/music/[trackId]/audio",
    method: "PUT",
    args: [id("trackId", "trackId", "The track's id, from `gx music add` or `gx music all`."), fileArg("The exact MP3 the owner named. Never downloaded, never converted, never generated.")],
    contentType: "audio/mpeg",
    flags: [],
    detail: "All or nothing: over 32 MB is a 413 before a byte is read, and a body shorter than its content-length is a 400 with nothing stored. If either happens the row still exists with `bytes: 0` — retry the upload rather than adding a second track.",
  },
  {
    group: "music",
    name: "audio",
    summary: "Read a track's stored audio back. Prints a summary; --raw writes the bytes to stdout.",
    route: "/api/music/[trackId]/audio",
    method: "GET",
    args: [id("trackId", "trackId", "The track's id.")],
    accept: "bytes",
    flags: [],
    detail: "Useful as a check that an upload landed whole: the size here should equal the size of the file on disk.",
  },
  {
    group: "music",
    name: "retitle",
    summary: "Fix a track's title without touching its audio.",
    route: "/api/music/[trackId]",
    method: "PATCH",
    args: [id("trackId", "trackId", "The track's id.")],
    flags: [b("title", "string", "The new title: non-blank, ≤ 120 characters, any charset.", { required: true })],
    detail: "There is no reorder counterpart and there will not be one: `MusicTrack` has no position and the player picks a track at random.",
  },
  {
    group: "music",
    name: "remove",
    summary: "Delete a track row and unlink its file.",
    route: "/api/music/[trackId]",
    method: "DELETE",
    args: [id("trackId", "trackId", "The track's id.")],
    flags: [],
  },

  /* -- play ----------------------------------------------------------------
     The owner's own record of having played a game, opened to agents by
     GAMEEXPLOR-0031 under one rule: **record, never infer.** Dictation is
     fine — "I finished Contra last night" is the owner telling you a fact
     about their evening. Deduction is not: a run reasoned out of a habit, a
     journal entry or a completion percentage is a fabricated memory, and
     unlike a wrong tag it is undetectable on the page afterwards. If a date
     was not stated, ask.

     `start` and `log` are two commands over one route because `POST
     /api/games/[id]/sessions` branches on whether an end date is present, and
     the mistake that branch invites is silent: with no `--ended-at` and no
     `--undated` the API opens a run claiming the owner is playing the game
     right now, which then blocks the next real one with a 409.

     Be precise about what the split buys, because it is less than it looks.
     It *names* the two intentions, so `gx play log` reads as a claim about the
     past and `gx play start` as a claim about the present; it does not
     *enforce* them. `gx play log <id> --started-at 1997-01-01` with neither an
     end date nor `--undated` still falls through to `startSession` and opens a
     live run, because the route sees a body indistinguishable from a start.
     Two named intentions and one honest warning, not a guard rail. */
  {
    group: "play",
    name: "list",
    summary: "One copy's runs, newest first, with the undated ones last.",
    route: "/api/games/[id]/sessions",
    method: "GET",
    args: [OWNED()],
    flags: [],
    detail:
      "`endedAt: null` is the one definition of a run in progress — there is no status column anywhere in this app. An `undated` run's two timestamps are the moment it was typed in, not when it was played: read them as nothing at all. " +
      "`startedPrecision` / `endedPrecision` say how precisely each end was claimed: `month` means the stored day is scaffolding and the app renders \"Aug 2026\", so do not report the 1st back to the owner as though they said it.",
  },
  {
    group: "play",
    name: "open",
    summary: "Every run in progress across the whole shelf, most recently started first.",
    route: "/api/sessions/open",
    method: "GET",
    args: [],
    flags: [],
    detail: "What the `/playing` page reads. Worth checking before you start a run: a copy that already has one open answers 409 rather than opening a second.",
  },
  {
    group: "play",
    name: "start",
    summary: "Start a run on a copy, now or from a stated date. Drops it out of the queue.",
    route: "/api/games/[id]/sessions",
    method: "POST",
    args: [OWNED("The copy being played. Runs are per copy: playing the NES Contra says nothing about the SNES one.")],
    flags: [
      b("started-at", "string", "When it started: `YYYY-MM` for a month, `YYYY-MM-DD` for a day (read as local midnight), or a full ISO timestamp. Defaults to now. The shape is the claim — if the owner said \"August\", send `2026-08`, not `2026-08-01`."),
      b("note", "string", "One line about the run, trimmed, ≤ 500 characters."),
    ],
    detail:
      "409 when this copy already has a run in progress — finish that one, do not retry. The queue entry for the copy is deleted in the same transaction, so a game is never both up next and in progress. " +
      "`--started-at` backdates the run and leaves it open, which is the shape behind the game page's \"Still playing\" outcome: a run that began in the past and has not ended.",
  },
  {
    group: "play",
    name: "log",
    summary: "Write down a run that already happened. Wants an end date, or --undated.",
    route: "/api/games/[id]/sessions",
    method: "POST",
    args: [OWNED("The copy that was played.")],
    flags: [
      b("started-at", "string", "When it started: `YYYY-MM` (a month), `YYYY-MM-DD` (a day) or ISO. Defaults to the end date — one sitting."),
      b("ended-at", "string", "When it ended: `YYYY-MM`, `YYYY-MM-DD` or ISO. This is what makes it a past run rather than an open one. The two ends are independent — a run may start on a day and end in a month."),
      b("undated", "bool", 'For "I played this at some point": no dates at all. Sending it together with a date is a 400.'),
      b("outcome", "string", "How it went. Defaults to completed.", { choices: ["completed", "abandoned"] }),
      b("note", "string", "One line about the run, ≤ 500 characters."),
    ],
    detail:
      "Only ever what the owner said. No date given means ask for one or use --undated — never reason a date out of a journal entry, a habit or a completion percentage. An end before the start is a 400. " +
      "**A month is a first-class answer and it is the right answer more often than a day**: \"last March\" is `--started-at 2026-03`, not a day you picked out of March. `2026-03-01` is a claim about the 1st and the app will render it as one.",
  },
  {
    group: "play",
    name: "finish",
    summary: "Close an open run: how it went, and the day it ended.",
    route: "/api/sessions/[sessionId]",
    method: "PATCH",
    args: [id("sessionId", "sessionId", "The run's id, from `gx play list` or `gx play open`.")],
    flags: [
      b("outcome", "string", "How it went. A run closed without one is recorded as completed.", { choices: ["completed", "abandoned"] }),
      // Required, and the API now demands it too (GAMEEXPLOR-0038) — belt and
      // braces rather than a lone guard.
      //
      // The history is worth keeping, because the flag was required first and
      // for a different reason. `PATCH /api/sessions/:id` used to keep the
      // stored `endedAt` when none was sent; on an open run that is null, and
      // the outcome was then forced back to "playing". So `gx play finish
      // --outcome completed` with no date exited 0, left the run open, and
      // discarded the outcome — a silent no-op whose only visible consequence
      // was a 409 on the next real start. The route refuses that shape with a
      // 400 now, so this flag is no longer the only thing standing between an
      // agent and that bug.
      //
      // It stays required on principle regardless: a finish with no stated end
      // date is a date the agent invented, which is the one thing "record,
      // never infer" forbids. If the owner did not say when, ask; do not let a
      // default answer for them.
      b("ended-at", "string", "When it ended: `YYYY-MM` if the owner named a month, `YYYY-MM-DD` or ISO if they named a day. There is no default: a finish with no stated end date is a date you invented, so if the owner did not say when, ask.", { required: true }),
      b("note", "string", "One line about the run, ≤ 500 characters."),
    ],
    detail: "The service keeps the outcome consistent with the dates: a closed run is never \"playing\". Ending a run before it started is a 400.",
  },
  {
    group: "play",
    name: "edit",
    summary: "Correct a run — its dates, its outcome, its note — or reopen it.",
    route: "/api/sessions/[sessionId]",
    method: "PATCH",
    args: [id("sessionId", "sessionId", "The run's id.")],
    flags: [
      b("started-at", "string", "A corrected start: `YYYY-MM`, `YYYY-MM-DD` or ISO. Sending a coarser shape is how you *remove* a day nobody actually knew."),
      b("ended-at", "json", 'JSON here, not a bare date: `null` reopens the run, a quoted `"2026-08-30"` or `"2026-08"` moves its end. For the everyday close use `gx play finish`.'),
      b("undated", "bool", '`--undated` forgets a run\'s dates; `--no-undated` is the "I remembered when that was" edit and must arrive with both real dates.'),
      b("outcome", "string", "How it went.", { choices: ["playing", "completed", "abandoned"] }),
      b("note", "string", "One line about the run, ≤ 500 characters."),
    ],
    detail:
      "Reopening obeys the one-open-run rule (409) and is refused outright on an undated run (400): its timestamps are the day it was typed in, so there is no moment to resume from. " +
      "Setting --outcome completed or abandoned on a run this edit leaves open is a 400 as well: closing a run needs an end date, and the API will not pick one for you. " +
      "Each date carries its own precision, and only a date you actually send is re-read: `--note` on a run recorded as a month leaves it a month.",
  },
  {
    group: "play",
    name: "remove",
    summary: "Delete a run. Its journal entries survive, detached from it.",
    route: "/api/sessions/[sessionId]",
    method: "DELETE",
    args: [id("sessionId", "sessionId", "The run's id.")],
    flags: [],
    detail: "For a run that should never have been recorded — yours by mistake, or one the owner says did not happen. Not for tidying somebody's history.",
  },

  /* -- queue ---------------------------------------------------------------
     "What should I play next" is a plan, not a memory: nothing here is
     invented, and a wrong entry is one tap to remove on `/playing`. That is
     the whole reason the queue opened to agents alongside runs while the
     journal did not. */
  {
    group: "queue",
    name: "list",
    summary: "The one ordered up-next list, in order, with each game's details.",
    route: "/api/queue",
    method: "GET",
    args: [],
    flags: [],
    detail: "Positions are dense 0..n-1 and the server renumbers after every write, so read the list back rather than assuming an index you saw earlier survived.",
  },
  {
    group: "queue",
    name: "add",
    summary: "Queue a copy, or move the one already queued. Appends by default.",
    route: "/api/queue",
    method: "POST",
    args: [bodyArg("ownedGameId", "ownedGameId", "The copy to queue — `ownedGameId` from `gx games search`. The queue is one global list, so this goes in the body, not the path.")],
    flags: [
      b("position", "int", "0-based slot to splice it into. Omit to append; on a game that is already queued this is the move."),
      b("note", "string", "One line on why it is next, ≤ 500 characters."),
    ],
    detail: "400 when that copy has a run in progress — it is already being played, so \"up next\" means nothing for it. 409 when the queue is full at 50.",
  },
  {
    group: "queue",
    name: "reorder",
    summary: "Set the whole order at once. A permutation: every queued game, exactly once.",
    route: "/api/queue",
    method: "PATCH",
    args: [],
    flags: [b("game", "string", "An ownedGameId, in the order you want it played — list every game currently queued.", { repeat: true, into: { kind: "body", field: "orderedIds" } }), BODY('`{ "orderedIds": [...] }`, if you would rather send the list as JSON.')],
    detail: "A game left out is a 400 carrying the current queue in `details.queued`, never a deletion — which is the point: a stale list cannot drop an entry by omission. Run `gx queue list --json` first, every time.",
  },
  {
    group: "queue",
    name: "remove",
    summary: "Take a game back out of the queue. The rest close up behind it.",
    route: "/api/queue/[ownedGameId]",
    method: "DELETE",
    args: [id("ownedGameId", "ownedGameId", "The queued copy's id. 404 when it was not in the queue.")],
    flags: [],
  },
];

/** Every command in one group, in registry order. */
export function commandsInGroup(group: string): Command[] {
  return COMMANDS.filter((c) => c.group === group);
}

/** One command by group and name, or undefined. */
export function findCommand(group: string, name: string): Command | undefined {
  return COMMANDS.find((c) => c.group === group && c.name === name);
}

/** Whether a group name exists. */
export function isGroup(name: string): boolean {
  return GROUPS.some((g) => g.name === name);
}
