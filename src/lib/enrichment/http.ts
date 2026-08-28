import { NextResponse } from "next/server";
import { z } from "zod";
import { EnrichmentError } from "./service";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EnrichmentError) return NextResponse.json({ error: e.message, details: e.details ?? null }, { status: e.status });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "invalid input", details: e.issues }, { status: 400 });
    if (e instanceof SyntaxError) return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 500 });
  }
}
