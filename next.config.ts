import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // This worktree's node_modules (and .cache/igdb-images, data/*) are
  // symlinks into a sibling checkout, which Turbopack otherwise refuses to
  // resolve through ("Symlink [project]/node_modules is invalid, it points
  // out of the filesystem root"). Opt-in via env var rather than a
  // hardcoded path, so a normal checkout — and the Mac mini deploy — is
  // unaffected; only a worktree set up this way needs to set it.
  ...(process.env.TURBOPACK_ROOT ? { turbopack: { root: process.env.TURBOPACK_ROOT } } : {}),
};

export default nextConfig;
