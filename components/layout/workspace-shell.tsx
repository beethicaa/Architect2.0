"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The scroll container for every screen inside the app.
 *
 * Two different rules, and getting this wrong in either direction is a real bug:
 *
 *   - A fixed-height workspace (`/projects/[id]`) must NOT scroll. Its panels
 *     scroll internally, so a scrolling parent adds a second scroll layer behind
 *     the fixed header: the window moves while the chat and preview stay put.
 *   - Everything else (dashboard, settings, profile) MUST scroll, because its
 *     content is taller than the viewport.
 *
 * This was previously decided once, globally, and whichever way it was set it
 * broke one screen to fix the other. Deciding it here — from the actual
 * pathname — is the only version that can be right for both.
 *
 * It is a client component purely because the pathname is. The layout itself
 * stays a server component, so auth and the profile read are unaffected.
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // `/projects/<id>` is the workspace. `/projects/settings` is not — it is a
  // settings page, and treating it as a workspace is how its content ends up
  // clipped with no way to scroll to it.
  const isWorkspace = /^\/projects\/[^/]+$/.test(pathname);

  return (
    <main
      data-scroll={isWorkspace ? "workspace" : "page"}
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isWorkspace ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      {children}
    </main>
  );
}
