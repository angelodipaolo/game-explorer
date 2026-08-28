import { notFound } from "next/navigation";
import { Badge, PageTitle } from "@/components/ui";
import { ImportError, getSession } from "@/lib/import/service";
import { ReviewTable } from "./review-table";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try {
    session = await getSession(id);
  } catch (e) {
    if (e instanceof ImportError && e.status === 404) notFound();
    throw e;
  }
  const rows = session.rows;
  const counts = {
    review: rows.filter((r) => r.decision === "review").length,
    auto: rows.filter((r) => r.decision === "auto").length,
    accepted: rows.filter((r) => r.decision === "accepted").length,
    merge: rows.filter((r) => r.decision === "merge").length,
    dropped: rows.filter((r) => r.decision === "dropped").length,
  };
  return (
    <>
      <PageTitle
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={session.status === "open" ? "warn" : session.status === "committed" ? "good" : "muted"}>{session.status}</Badge>
            <span>{rows.length} rows</span>
            <span>·</span>
            <span>{counts.auto} matched automatically</span>
            <span>·</span>
            <span className={counts.review ? "text-warn" : ""}>{counts.review} need a decision</span>
            {counts.merge ? <span>· {counts.merge} merge</span> : null}
            {counts.dropped ? <span>· {counts.dropped} dropped</span> : null}
          </span>
        }
      >
        {session.label}
      </PageTitle>
      <ReviewTable
        session={{ id: session.id, status: session.status, batchId: session.batch?.id ?? null }}
        rows={rows.map((r) => ({
          id: r.id,
          index: r.index,
          title: r.title,
          platform: r.platform,
          quantity: r.quantity,
          problems: JSON.parse(r.problems) as string[],
          dedupeKind: r.dedupeKind,
          candidates: JSON.parse(r.candidates),
          decision: r.decision,
          holdReason: r.holdReason,
          chosenIgdbId: r.chosenIgdbId,
          chosenConfidence: r.chosenConfidence,
          decidedBy: r.decidedBy,
        }))}
      />
    </>
  );
}
