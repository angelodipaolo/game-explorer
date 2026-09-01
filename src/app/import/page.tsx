import Link from "next/link";
import { Badge, Card, PageTitle } from "@/components/ui";
import { listBatches, listSessions } from "@/lib/import/service";
import { CsvDrop } from "./csv-drop";
import { RollbackButton } from "./rollback-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

const statusTone = { open: "warn", committed: "good", discarded: "muted" } as const;

export default async function ImportPage() {
  const [sessions, batches] = await Promise.all([listSessions(), listBatches()]);
  return (
    <>
      <PageTitle sub="Drop a CSV, or point an agent at the API. Nothing reaches the shelf until you commit, and every commit can be undone.">Import</PageTitle>

      <CsvDrop />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-faint">No sessions yet.</p>
        ) : (
          <ul className="grid gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/import/${s.id}`} className="block">
                  <Card className="flex items-center justify-between gap-3 px-4 py-3 transition hover:border-muted">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.label}</div>
                      <div className="text-xs text-muted">
                        {s._count.rows} rows · {s.source} · {new Date(s.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <Badge tone={statusTone[s.status as keyof typeof statusTone] ?? "muted"}>{s.status}</Badge>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Committed batches</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-faint">Nothing committed yet.</p>
        ) : (
          <ul className="grid gap-2">
            {batches.map((b) => (
              <li key={b.id}>
                <Card className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.label}</div>
                    <div className="text-xs text-muted">
                      {b._count.effects} changes · {new Date(b.committedAt).toLocaleString()}
                      {b.rolledBackAt ? ` · rolled back ${new Date(b.rolledBackAt).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={b.status === "committed" ? "good" : "muted"}>{b.status.replace("_", " ")}</Badge>
                    {b.status === "committed" ? <RollbackButton batchId={b.id} /> : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 text-xs text-faint">
        <p>
          Agents: <code className="text-muted">POST /api/import/sessions</code> with structured rows, then{" "}
          <code className="text-muted">POST /api/import/sessions/:id/commit</code>. Undo with <code className="text-muted">POST /api/import/batches/:id/rollback</code>. The skill
          in <code className="text-muted">.claude/skills/curate-collection</code> (<code className="text-muted">reference/games.md</code>) has the whole path.
        </p>
      </section>
    </>
  );
}
