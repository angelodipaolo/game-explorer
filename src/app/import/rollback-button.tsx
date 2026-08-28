"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function RollbackButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function run() {
    setBusy(true);
    const res = await fetch(`/api/import/batches/${batchId}/rollback`, { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert((await res.json()).error);
  }
  if (!confirm)
    return (
      <Button variant="ghost" onClick={() => setConfirm(true)}>
        Undo
      </Button>
    );
  return (
    <div className="flex items-center gap-2">
      <Button variant="danger" onClick={run} disabled={busy}>
        {busy ? "Undoing…" : "Undo this import"}
      </Button>
      <Button variant="ghost" onClick={() => setConfirm(false)}>
        Keep
      </Button>
    </div>
  );
}
