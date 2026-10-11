import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // scripts/deploy.sh builds into a separate folder (NEXT_DIST_DIR) while the
  // live app keeps serving from .next, then swaps them. Unset = normal ".next".
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
