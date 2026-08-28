"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, cx } from "@/components/ui";
import { platformLabel, resolvePlatform } from "@/lib/platforms";

type Candidate = { igdbId: number; name: string; confidence: number; reason: string; firstReleaseYear: number | null; platformNames: string[]; coverImageId: string | null; onPlatform: boolean };
export type ReviewRow = {
  id: string;
  index: number;
  title: string;
  platform: string;
  quantity: number;
  problems: string[];
  dedupeKind: string;
  candidates: Candidate[];
  decision: string;
  holdReason: string | null;
  chosenIgdbId: number | null;
  chosenConfidence: number | null;
  decidedBy: string | null;
};

const holdLabel: Record<string, string> = {
  "no-match": "No match found",
  ambiguous: "Two plausible matches",
  "low-confidence": "Best guess is shaky",
  duplicate: "Already on the shelf",
  invalid: "Can't import as-is",
};

const decisionTone: Record<string, "warn" | "good" | "info" | "muted" | "bad"> = {
  review: "warn",
  auto: "good",
  accepted: "good",
  merge: "info",
  dropped: "muted",
};

export function ReviewTable({ session, rows }: { session: { id: string; status: string; batchId: string | null }; rows: ReviewRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"needs" | "all">(rows.some((r) => r.decision === "review") ? "needs" : "all");
  const open = session.status === "open";

  const ordered = useMemo(() => {
    const weight: Record<string, number> = { review: 0, auto: 2, accepted: 1, merge: 3, dropped: 4 };
    return [...rows].sort((a, b) => weight[a.decision] - weight[b.decision] || a.index - b.index);
  }, [rows]);
  const visible = filter === "needs" ? ordered.filter((r) => r.decision === "review") : ordered;
  const unresolved = rows.filter((r) => r.decision === "review").length;

  async function call(label: string, url: string, init: RequestInit) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `${res.status}`);
      router.refresh();
      return json;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const decideRow = (row: ReviewRow, body: Record<string, unknown>) => call(row.id, `/api/import/sessions/${session.id}/rows/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border bg-surface p-1 text-sm">
          {(["needs", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cx("rounded-lg px-3 py-1.5", filter === f ? "bg-surface-2 text-text" : "text-muted")}>
              {f === "needs" ? `Needs a decision (${unresolved})` : `All rows (${rows.length})`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {open ? (
            <>
              <Button variant="ghost" disabled={busy != null} onClick={() => call("discard", `/api/import/sessions/${session.id}`, { method: "DELETE" }).then(() => router.push("/import"))}>
                Discard
              </Button>
              <Button
                variant="primary"
                disabled={busy != null}
                data-testid="commit"
                onClick={() =>
                  call("commit", `/api/import/sessions/${session.id}/commit`, { method: "POST", body: JSON.stringify({ force: unresolved > 0 }) }).then((r) => {
                    if (r) router.push("/import");
                  })
                }
              >
                {unresolved ? `Commit (${unresolved} unmatched go in without a match)` : "Commit to shelf"}
              </Button>
            </>
          ) : session.batchId ? (
            <Button variant="danger" disabled={busy != null} onClick={() => call("rollback", `/api/import/batches/${session.batchId}/rollback`, { method: "POST" })}>
              Undo this import
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</p> : null}

      {visible.length === 0 ? <p className="py-10 text-center text-sm text-faint">Nothing needs a decision. Commit when ready.</p> : null}

      <ul className="grid gap-3">
        {visible.map((row) => {
          const chosen = row.candidates.find((c) => c.igdbId === row.chosenIgdbId);
          return (
            <li key={row.id}>
              <Card className={cx("p-4", row.decision === "dropped" && "opacity-60")} data-testid="import-row">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.title}</span>
                      <Badge>{platformLabel(row.platform)}</Badge>
                      {row.quantity > 1 ? <Badge>×{row.quantity}</Badge> : null}
                      <Badge tone={decisionTone[row.decision]}>{row.decision}</Badge>
                      {row.holdReason ? <span className="text-xs text-warn">{holdLabel[row.holdReason] ?? row.holdReason}</span> : null}
                    </div>
                    {row.problems.length ? <p className="mt-1 text-sm text-bad">{row.problems.join("; ")}</p> : null}
                    {row.decision !== "review" && chosen ? (
                      <p className="mt-1 text-sm text-muted">
                        → {chosen.name} {chosen.firstReleaseYear ? `(${chosen.firstReleaseYear})` : ""} · {Math.round(chosen.confidence * 100)}% · {chosen.reason}
                      </p>
                    ) : row.decision === "accepted" && row.chosenIgdbId ? (
                      <p className="mt-1 text-sm text-muted">→ IGDB #{row.chosenIgdbId}</p>
                    ) : row.decision === "accepted" ? (
                      <p className="mt-1 text-sm text-muted">→ imported without a catalog match</p>
                    ) : row.decision === "merge" ? (
                      <p className="mt-1 text-sm text-muted">→ quantity folded into the {row.dedupeKind === "existing" ? "shelf copy" : "earlier row"}</p>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="flex flex-wrap gap-2">
                      {row.decision !== "dropped" ? (
                        <Button variant="ghost" disabled={busy != null} onClick={() => decideRow(row, { decision: "dropped" })}>
                          Drop
                        </Button>
                      ) : (
                        <Button variant="ghost" disabled={busy != null} onClick={() => decideRow(row, { decision: "accepted", igdbId: row.chosenIgdbId })}>
                          Restore
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>

                {open && row.decision === "review" && row.holdReason !== "invalid" ? (
                  <div className="mt-3 grid gap-2">
                    {row.dedupeKind === "existing" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" disabled={busy != null} onClick={() => decideRow(row, { decision: "merge" })}>
                          Add {row.quantity} to the shelf copy
                        </Button>
                        <Button disabled={busy != null} onClick={() => decideRow(row, { decision: "dropped" })}>
                          Skip it
                        </Button>
                      </div>
                    ) : (
                      <>
                        {row.candidates.slice(0, 5).map((c, i) => {
                          const otherPlatform = !c.onPlatform
                            ? c.platformNames
                                .map((n) => resolvePlatform(n))
                                .filter((p) => p && p.slug !== row.platform)
                                .sort((a, b) => a!.year - b!.year)[0]
                            : null;
                          return (
                          <button
                            key={c.igdbId}
                            disabled={busy != null}
                            onClick={() => decideRow(row, { decision: "accepted", igdbId: c.igdbId, ...(otherPlatform ? { platform: otherPlatform.slug } : {}) })}
                            className="flex items-center gap-3 rounded-xl border border-border bg-bg-elev px-3 py-2 text-left transition hover:border-accent"
                            data-testid="candidate"
                          >
                            {c.coverImageId ? (
                              <img src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${c.coverImageId}.jpg`} alt="" className="h-12 w-9 rounded object-cover" />
                            ) : (
                              <div className="h-12 w-9 rounded bg-surface-2" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {c.name} <span className="text-muted">{c.firstReleaseYear ?? ""}</span>
                              </span>
                              <span className="block truncate text-xs text-muted">
                                {Math.round(c.confidence * 100)}% · {c.reason}
                                {!c.onPlatform ? ` · ${c.platformNames.slice(0, 3).join(", ")}` : ""}
                              </span>
                            </span>
                            {otherPlatform ? <Badge tone="info">move to {otherPlatform.short}</Badge> : null}
                            {i === 0 ? <Badge tone="accent">best</Badge> : null}
                          </button>
                          );
                        })}
                        <Button variant="ghost" disabled={busy != null} onClick={() => decideRow(row, { decision: "accepted", igdbId: null })} className="justify-start">
                          Import without a match
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
