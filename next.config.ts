import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Pin the Turbopack workspace root to this project. Without it Next walks up
   * the directory tree looking for a lockfile and warns when it finds one
   * outside the repo (e.g. a stray package-lock.json in the user's home dir).
   */
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

