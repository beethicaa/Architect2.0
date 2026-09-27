import { networkInterfaces } from "node:os";

import type { NextConfig } from "next";

/**
 * Hostnames the dev server is allowed to serve dev-only assets and endpoints
 * from.
 *
 * Why this exists: Next blocks cross-origin requests to dev-only endpoints by
 * default, allowing only `localhost` and the hostname the server was started
 * with. That is the right default for security, but it breaks a very ordinary
 * developer habit - opening `http://<your-lan-ip>:3000` on a phone or a second
 * machine to check a layout. The symptom is silent and confusing:
 *
 *   WebSocket connection to 'ws://192.168.1.4:3000/_next/hmr' failed
 *
 * The page renders, but hot reload is dead, so you edit code and have to
 * manually refresh to see anything - and on a phone, which refreshes constantly,
 * it looks like the app is just "failing continuously".
 *
 * Only the hostname is matched: no scheme, no port, no path. `*` stands for one
 * label and `**` for one or more, so we add each real interface address rather
 * than a blanket rule.
 *
 * `ALLOWED_DEV_ORIGINS` lets someone add an entry (e.g. a tunnel hostname)
 * without editing this file.
 */
const LAN_HOSTNAMES: string[] = (() => {
  const found = new Set<string>();

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      // IPv4 only: a phone on the same wifi uses the LAN IPv4 address. IPv6
      // link-local addresses (fe80::/10) include a scope id and would be
      // meaningless as an origin entry.
      if (address.family === "IPv4" && !address.internal) {
        found.add(address.address);
      }
    }
  }

  return [...found];
})();

const EXTRA_ORIGINS = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  /**
   * Pin the Turbopack workspace root to this project. Without it Next walks up
   * the directory tree looking for a lockfile and warns when it finds one
   * outside the repo (e.g. a stray package-lock.json in the user's home dir).
   */
  turbopack: {
    root: __dirname,
  },

  /**
   * esbuild and the Anthropic SDK stay outside the server bundle.
   *
   * esbuild is a native binary (`esbuild.exe` plus a README). Turbopack tries to
   * bundle every file it reaches and fails on both with "Unknown module type",
   * which takes the whole build down. `serverExternalPackages` tells Next to
   * leave these in `node_modules` and `require` them at runtime instead.
   *
   * The Anthropic SDK is listed for the same reason: it ships its own JSON
   * fixtures and is large enough that bundling it buys nothing on a server that
   * already has node_modules.
   *
   * The two single-file-component compilers are here for a sharper reason: the
   * preview loads them dynamically, and Turbopack tries to resolve a dynamic
   * import at build time. Bundling `@vue/compiler-sfc` failed the build outright
   * ("Module not found"), because that package resolves its own sub-graphs in a
   * way the bundler cannot follow. They are server-only by nature — they run
   * while compiling a preview document and never reach a browser — so leaving
   * them to `require` at runtime is the correct arrangement, not a workaround.
   */
  serverExternalPackages: [
    "esbuild",
    "openai",
    /*
     * The Tailwind toolchain, used at runtime by the preview compiler.
     *
     * `lightningcss` is a native binary and Turbopack fails to resolve it as a
     * dynamic `.node` import, which takes the whole build down. The rest are
     * left external for the same reason as esbuild: they are server-side build
     * tools that run while compiling a preview and never reach a browser, so
     * bundling them buys nothing and only creates resolution problems.
     *
     * These are runtime `dependencies`, not devDependencies, because the preview
     * is compiled on demand by the deployed server. `@tailwindcss/cli` was here
     * as a devDependency and was spawned at runtime, which meant every deployed
     * build silently fell back to an unstyled document.
     */
    "@tailwindcss/cli",
    "@tailwindcss/node",
    "@tailwindcss/oxide",
    "lightningcss",
    "@vue/compiler-sfc",
    "svelte",
    "svelte/compiler",
  ],

  allowedDevOrigins: [...LAN_HOSTNAMES, ...EXTRA_ORIGINS],

  /*
   * Ship the pre-bundled React *inside the serverless function*.
   *
   * Vercel serves `public/` from the CDN and traces server files separately, so
   * a file that is reachable at `https://the-app/preview/react.js` is not
   * necessarily present at `/var/task/public/preview/react.js` inside the
   * function. The preview compiler reads it from disk, and got
   * "Cannot read file: /var/task/public/preview/react.js" on every build in
   * production while working locally.
   *
   * `outputFileTracingIncludes` is the documented way to tell Next to include
   * those files in the function's own bundle. It is scoped to the one route
   * that needs them, so no other function carries 190KB it will never read.
   */
  outputFileTracingIncludes: {
    "/api/projects/[id]/preview": ["./public/preview/**"],
    "/api/projects/[id]/repair": ["./public/preview/**"],
    /*
     * The deploy route reads the same pre-bundled React, to ship it *inside* the
     * deployment.
     *
     * Without this it worked locally and produced a blank page in production: the
     * document imported `/preview/react-runtime.js`, that file was not in the
     * function, and the deployed app's only import 404'd. The page returned 200
     * with a complete stylesheet and an empty root element.
     */
    "/api/projects/[id]/deploy": ["./public/preview/**"],
  },
};

export default nextConfig;
