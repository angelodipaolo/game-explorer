"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, cx } from "@/components/ui";

export function CsvDrop() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("NES");

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("label", file.name);
      form.set("defaultPlatform", platform);
      const res = await fetch("/api/import/csv", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `upload failed (${res.status})`);
      router.push(`/import/${json.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
      className={cx(
        "rounded-2xl border-2 border-dashed p-6 text-center transition",
        over ? "border-accent bg-accent/5" : "border-border bg-surface",
      )}
      data-testid="csv-drop"
    >
      <p className="font-medium">{busy ? "Reading and matching…" : "Drop a CSV here"}</p>
      <p className="mt-1 text-sm text-muted">Any file with a title/name column. Platform, quantity, notes and condition columns are picked up if present.</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          Assume platform
          <input
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-24 rounded-lg border border-border bg-bg px-2 py-1.5 text-text"
            aria-label="Default platform"
          />
        </label>
        <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          data-testid="csv-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
    </div>
  );
}
