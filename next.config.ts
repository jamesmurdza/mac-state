import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Single page + a handful of /api/* route handlers; no rewrites/redirects needed.
  // Lets `next dev`'s HMR websocket (and other dev-only resources) work when the app is
  // accessed through the Daytona sandbox's proxy domain instead of localhost directly --
  // otherwise Next blocks cross-origin dev requests by default. Harmless in production
  // (allowedDevOrigins is a dev-only check).
  allowedDevOrigins: ["*.daytonaproxy01.net"],
};

export default nextConfig;
