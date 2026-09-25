/**
 * The lens: Simple vs Developer.
 *
 * This is the mechanic the whole product is built on (docs/product-vision.md).
 * Two rules keep it honest and both are enforced structurally here:
 *
 *  1. The lens is a *presentation* concern. It lives in a client provider, and
 *     it never reaches a Supabase query or changes a mock payload.
 *  2. Both lenses render the same underlying run data. Components read the lens
 *     to choose copy and density — never to fetch something different.
 *
 * The provider is deliberately tiny: one piece of state, persisted to a cookie
 * so a refresh doesn't flip a technical user's workspace back to plain language.
 */

"use client";

import * as React from "react";

import type { ViewMode } from "@/lib/types/domain";

const STORAGE_KEY = "architect:view-mode";

export const VIEW_MODE_COOKIE = "architect-view-mode";

/**
 * Plain-language and technical wording for the same event. Anything that must
 * be said differently in the two lenses belongs in a record here, so the two
 * versions can never drift apart in wording.
 */
export const LENS_COPY = {
  lensName: {
    simple: "Simple",
    developer: "Developer",
  } satisfies Record<ViewMode, string>,

  lensHint: {
    simple: "Plain language. Code is one click away.",
    developer: "Agents, models, tokens and files.",
  } satisfies Record<ViewMode, string>,

  buildHeading: {
    simple: "Building your app",
    developer: "Agent run",
  } satisfies Record<ViewMode, string>,

  buildSubheading: {
    simple: "You don't need to do anything. We'll ask if we need you.",
    developer: "Live run state, token spend and files written per step.",
  } satisfies Record<ViewMode, string>,

  architectureHeading: {
    simple: "The team building your app",
    developer: "Orchestration graph",
  } satisfies Record<ViewMode, string>,

  architectureSubheading: {
    simple: "Each box is a specialist. They hand work to each other.",
    developer: "Nodes, handoffs, models and outputs. Click a node to inspect it.",
  } satisfies Record<ViewMode, string>,

  /** What a state is *called* to each audience. The dot colour never changes. */
  stateLabel: {
    queued: { simple: "Waiting", developer: "queued" },
    working: { simple: "Working", developer: "running" },
    done: { simple: "Done", developer: "succeeded" },
    "needs-you": { simple: "Needs you", developer: "awaiting input" },
    failed: { simple: "Stopped", developer: "failed" },
  } satisfies Record<
    RunStateKey,
    { simple: string; developer: string }
  >,
} as const;

type RunStateKey = "queued" | "working" | "done" | "needs-you" | "failed";

export type LensCopy = typeof LENS_COPY;

/* ------------------------------------------------------------- the store */

/**
 * The lens is kept in a tiny external store rather than in component state,
 * because it has to survive unmounts (it lives in the app chrome, and every
 * screen below it reads it) and because it has to be readable on the server.
 *
 * `useSyncExternalStore` is the correct primitive here: it subscribes to an
 * external system, gives a server snapshot, and — unlike a `useState` + `useEffect`
 * pair — never sets state inside an effect body, so there is no cascading render
 * and no flash of the wrong lens.
 */
const listeners = new Set<() => void>();

function readStoredMode(): ViewMode {
  if (typeof window === "undefined") return "simple";
  return window.localStorage.getItem(STORAGE_KEY) === "developer"
    ? "developer"
    : "simple";
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changing the lens should update this one — cheap to support and
  // it makes the preference feel like a real setting rather than tab state.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ViewMode {
  return readStoredMode();
}

/**
 * The neutral default documented on `ViewModeProvider`. Exported so a Server
 * Component can reuse the exact same fallback if it ever needs to render lens-
 * dependent copy without the provider.
 */
export const DEFAULT_VIEW_MODE: ViewMode = "simple";

function writeStoredMode(mode: ViewMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode / storage disabled: the lens still works for this session.
  }
  for (const listener of listeners) listener();
}

interface ViewModeContextValue {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** `true` when a sentence should be worded for a technical reader. */
  isDeveloper: boolean;
}

const ViewModeContext = React.createContext<ViewModeContextValue | null>(null);

/**
 * `defaultMode` is what a Server Component passed in (it read the cookie). It
 * is used for the very first client render; the stored preference takes over as
 * soon as the subscription is established.
 */
export function ViewModeProvider({
  children,
  defaultMode = "simple",
}: {
  children: React.ReactNode;
  defaultMode?: ViewMode;
}) {
  // One subscription: the stored preference on the client, and the
  // server-provided `defaultMode` for the hydration render.
  const viewMode = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultMode,
  );

  const setViewMode = React.useCallback((mode: ViewMode) => {
    writeStoredMode(mode);
    try {
      // A cookie as well, so the *next* server render can pick it up and avoid
      // rendering the other audience's copy on first paint.
      document.cookie = `${VIEW_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Non-browser context; nothing to persist.
    }
  }, []);

  const value = React.useMemo<ViewModeContextValue>(
    () => ({
      viewMode,
      setViewMode,
      isDeveloper: viewMode === "developer",
    }),
    [viewMode, setViewMode],
  );

  return (
    <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
  );
}

export function useViewMode(): ViewModeContextValue {
  const context = React.useContext(ViewModeContext);
  if (!context) {
    throw new Error("useViewMode must be used inside <ViewModeProvider>.");
  }
  return context;
}

/**
 * Word a status for the current lens.
 *
 * Every status surface goes through this, which is why the five states read the
 * same way everywhere. Simple gets a sentence, developer gets the run term.
 */
export function useStateLabel() {
  const { isDeveloper } = useViewMode();
  return React.useCallback(
    (state: RunStateKey) =>
      isDeveloper
        ? LENS_COPY.stateLabel[state].developer
        : LENS_COPY.stateLabel[state].simple,
    [isDeveloper],
  );
}
