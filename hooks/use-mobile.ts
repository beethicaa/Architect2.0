"use client";

import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Deliberately NOT the shadcn default implementation.
 *
 * The stock hook calls `setState` inside an effect body, which trips React 19's
 * `react-hooks/set-state-in-effect` rule (and causes a cascading render on every
 * mount). `useSyncExternalStore` subscribes to the media query directly: no
 * effect, no extra render, and it is SSR-safe — the server snapshot is "desktop",
 * which matches our desktop-first builder.
 */
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
