import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // JobDraft lives inside the Tradenaya repo; pin the project root so Next
  // never treats the parent folder (its own lockfile) as the workspace root.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  // The e2e tests run a second dev server, so they use their own build folder.
  distDir: process.env.JOBDRAFT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Keep the dev-only indicator away from the mobile bottom tab bar.
  devIndicators: { position: "top-right" },
  reactStrictMode: true,
};

export default nextConfig;
