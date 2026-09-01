# Codes

See `SKILL.md` for the env/auth preamble — do not skip it.

Codes live on an owned **copy**, not on a title: the NES and SNES versions of
one game hold separate sets, because Game Genie codes genuinely differ per
platform. Always write to the `ownedGameId` the gaps endpoint gave you.

There is no notion of who wrote a code. Whatever you record is the same kind of
record as a code the owner typed in on the game page, rendered identically, and
editable and deletable by them. Nothing you write outranks anything, and
nothing they wrote blocks you — so the only thing keeping the section useful is
your judgement about what to put in it.

IGDB has no cheat or password data (`/v4/cheats`, `/v4/game_cheats`, `/v4/codes`
do not exist), so everything here comes from research. `games.websites` in the
catalog sometimes links a wiki worth reading — a lead, not a source of truth.

## The four kinds

| `kind` | What belongs in it |
| --- | --- |
| `password` | A continue or level password typed at a password screen |
| `cheat` | Something built into the game: a button sequence, a name-entry trick, a debug menu |
| `game-genie` | A Game Genie code for that platform |
| `action-replay` | Pro Action Replay, GameShark, and the rest of the cheat-device family — name the device in `effect` or `note` |

## What goes in which field

- **`effect`** — what it does, in plain words, as you would say it out loud:
  "Infinite lives", "Start on stage 5", "Keep your weapon after dying".
  Required.
- **`code`** — the code itself, exactly as it is entered. Leave it out when the
  button sequence *is* the code; the effect then keys the row.
- **`howTo`** — where and how to enter it: "At the title screen, press Up, Up,
  Down, Down…", "Enter as your player name". Only when it is not obvious.
- **`sourceUrl`** — where you found it. Not enforced, but record one whenever
  you have it: months later it is the only way to tell a good code from a
  typo.
- **`note`** — anything else worth knowing: which revision it works on, side
  effects, a device name.
- **`verified`** — leave it `false`. It means "tried on hardware and it works",
  and you have not tried it.

## Rules

1. **Don't write a code you can't stand behind.** A wrong Game Genie code costs
   someone a play session. Prefer a page that lists codes for the specific
   release over an aggregator that merges platforms.
2. **Prefer the cartridge release over a port.** Codes for the arcade or Virtual
   Console version usually do not apply to the copy on the shelf.
3. **A curated handful, not a dump.** Aim for 5–20 per game — the ones someone
   would actually want. The cap is 30 and the API skips past it.
4. **Codes are per copy.** Use the `ownedGameId` from the gaps response, never a
   title.
5. **Leave a game empty rather than guess.** A game with no codes is honest; a
   game with plausible-looking wrong ones is worse than nothing.

## Path

```bash
# Games with no codes at all (or none of a kind)
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/codes/gaps?limit=50"
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" "$GAME_EXPLORER_URL/api/codes/gaps?kinds=game-genie&limit=50"
# → { total, gaps: [{ ownedGameId, title, name, platform, year, igdbId, have }] }
# `have` is what that copy already holds per kind — don't redo it.

# Research, then write across as many games as you like in one request
curl -s -H "Authorization: Bearer $GAME_EXPLORER_TOKEN" -X POST "$GAME_EXPLORER_URL/api/codes" -H 'content-type: application/json' -d '{
  "codes": [
    { "ownedGameId": "…", "kind": "game-genie", "effect": "Infinite lives",
      "code": "SXIOPO", "sourceUrl": "https://…" },
    { "ownedGameId": "…", "kind": "cheat", "effect": "30 lives",
      "howTo": "At the title screen press Up, Up, Down, Down, Left, Right, Left, Right, B, A, then Start.",
      "sourceUrl": "https://…", "note": "The Konami code — NES release only." }
  ]
}'
# → { written: [...], skipped: [{ ownedGameId, kind, effect, reason }] }
```

Partial success is normal: a bad entry is skipped with a reason and the rest
still land. Read `skipped` — the reasons are "unknown kind", "owned game not
found", and "already at the 30-code limit".

For one game by hand: `GET /api/games/:id/codes` lists a copy's set; `POST
/api/games/:id/codes` with the same body minus `ownedGameId`; `PATCH
/api/games/:id/codes/:codeId` to edit or tick `verified`; `DELETE` the same
path to remove.

## Report

Say how many copies you looked at, how many codes you wrote and to how many
games, which games you deliberately left empty and why, and anything the API
skipped with its reason. Codes appear on `/game/<id>` under
**Codes & passwords**, grouped by kind, with a ↗ to each source.
