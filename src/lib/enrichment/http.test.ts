import { describe, expect, it } from "vitest";
import { readUploadBody } from "./http";

/**
 * The guard around every raw-bytes upload (map images, journal photos, manual
 * scans, music). Next buffers a request body through proxy.ts up to
 * `proxyClientMaxBodySize` and then *continues with the partial body* — so a
 * route that trusts `arrayBuffer()` stores half a file and answers 200. These
 * are the two checks that make that impossible to mistake for success.
 */

const MAX = 1024;

const req = (body: Buffer, contentLength?: string | null) =>
  new Request("http://test/api/x", {
    method: "PUT",
    body: new Uint8Array(body),
    headers: contentLength === undefined ? {} : contentLength === null ? {} : { "content-length": contentLength },
  });

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

describe("readUploadBody", () => {
  it("passes a body whose length matches what was declared", async () => {
    const bytes = Buffer.alloc(64, 7);
    const buf = await readUploadBody(req(bytes, "64"), MAX, "audio");
    expect(buf).toHaveLength(64);
  });

  it("refuses an oversize upload before reading it", async () => {
    // The declared length alone is enough: nothing is buffered, nothing stored.
    expect(await status(() => readUploadBody(req(Buffer.alloc(8), String(MAX + 1)), MAX, "audio"))).toBe(413);
  });

  it("refuses a body that arrived shorter than it promised", async () => {
    // Exactly the truncation shape: the header says 900, 100 bytes turned up.
    expect(await status(() => readUploadBody(req(Buffer.alloc(100), "900"), MAX, "audio"))).toBe(400);
  });

  it("refuses an empty body", async () => {
    expect(await status(() => readUploadBody(req(Buffer.alloc(0), "0"), MAX, "image"))).toBe(400);
  });

  it("accepts a body with no declared length", async () => {
    // Chunked: there is no promise to check it against, so the service's own
    // size cap is what applies.
    const buf = await readUploadBody(req(Buffer.alloc(32, 1)), MAX, "audio");
    expect(buf).toHaveLength(32);
  });
});
