import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Every request in this app passes through `src/proxy.ts`, so Next buffers
     * each body in memory to let both the proxy and the route read it — and it
     * caps that buffer at **10 MB by default**, then continues with the partial
     * body rather than failing (see its `proxyClientMaxBodySize` docs). The
     * effect on an upload route is silent corruption: half a file stored, a
     * recorded size that matches the half, and a 200.
     *
     * 32 MB is the largest cap any domain here allows (`MAX_AUDIO_BYTES`;
     * images are 16 MB), so the framework limit now sits above every limit this
     * app enforces itself, and oversize uploads are refused by the route with a
     * 413 instead of being quietly trimmed. `readUploadBody` in
     * src/lib/enrichment/http.ts is the belt to this braces.
     */
    proxyClientMaxBodySize: "32mb",
  },
};

export default nextConfig;
