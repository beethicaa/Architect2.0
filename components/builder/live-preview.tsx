"use client";

/**
 * The live preview: the agent's actual output, running.
 *
 * An iframe pointed at `/api/projects/[id]/preview`, which compiles the project's
 * real files with esbuild and Tailwind. Nothing is drawn here - the frame loads a
 * document built from what the model wrote, so the app has its own state, its own
 * handlers and its own localStorage.
 *
 * `refresh` is bumped by the agent hook on every write, which is what makes the
 * app update the moment a file changes.
 */

import { RefreshCw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Device = "desktop" | "tablet" | "phone";

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "w-full",
  tablet: "max-w-[42rem]",
  phone: "max-w-[23rem]",
};

export function LivePreview({
  projectId,
  refresh,
  running,
  hasFiles,
  className,
}: {
  projectId: string;
  refresh: number;
  running: boolean;
  hasFiles: boolean;
  className?: string;
}) {
  const [device, setDevice] = React.useState<Device>("desktop");
  const [nonce, setNonce] = React.useState(0);
  const [repairing, setRepairing] = React.useState(false);
  const [repairError, setRepairError] = React.useState<string | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // The error is stored against the build it came from rather than cleared in an
  // effect: a new build is a new `version`, so the stale message simply stops
  // matching. Clearing on a timer would also be wrong here - the two requests can
  // land out of order, and the older failure would win.
  const [failure, setFailure] = React.useState<{ version: number; text: string } | null>(null);

  // The agent hook bumps `refresh` on every write; a manual reload adds to it so
  // both paths invalidate the same cache key.
  const version = refresh + nonce;
  // A counter, not a content key.
  //
  // It resets to 0 on every page load, so the browser can be holding a document
  // from an earlier build under the very same URL - which is exactly how a user
  // ended up staring at "seedDataIfEmpty is not a function" while the Code tab
  // showed that function sitting in lib/storage.ts. The two disagreed and
  // nothing on screen said which was stale.
  //
  // The route now returns `x-architect-fingerprint`: a hash of the exact file
  // contents behind the document. Folding it into the URL makes the document
  // content-addressed, so different files can never share a URL and a stale
  // preview cannot be served at all.
  //
  // The nonce exists because content-addressing alone has a hole: the fingerprint
  // is only known *after* a successful response, so a run that fails to compile
  // keeps the same URL forever and the browser is free to reuse the document it
  // already has. That is how one specific error survived three rounds of fixing
  // code that provably no longer produced it — the panel was showing a cached
  // document from a project that had since been deleted and re-imported.
  //
  // A per-mount nonce guarantees the first request of every visit is fresh, and
  // the fingerprint then pins it to the exact files for as long as they hold.
  const [visitId] = React.useState(() => Math.random().toString(36).slice(2, 10));
  const [fingerprint, setFingerprint] = React.useState("");
  const src = `/api/projects/${projectId}/preview?v=${version}&n=${visitId}&h=${fingerprint}`;
  const runtimeError = failure && failure.version === version ? failure.text : null;

  /*
   * The build note comes back as a response header rather than being scraped out
   * of the iframe, which would need a same-origin access the sandbox deliberately
   * withholds. Scoped to this version, for the same reason the runtime error is:
   * a newer build invalidates an older message, and the two requests can land
   * out of order.
   */
  const [buildNote, setBuildNote] = React.useState<{ version: number; text: string } | null>(
    null,
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // A HEAD would be ideal, but the route builds the document to answer, so
      // the cheapest honest read is the same GET the frame makes, discarded.
      const response = await fetch(src, { cache: "no-store" }).catch(() => null);
      if (cancelled || !response) return;

      // The route refuses an anonymous caller with 401 rather than compiling an
      // empty workspace, which is the honest answer but an invisible one: the
      // frame would simply be blank. Surfacing it here means a signed-out visitor
      // is told to sign in, rather than being left to wonder whether the build is
      // broken. A network failure is deliberately not handled the same way —
      // keeping the previous document is more useful than clearing it.
      if (response.status === 401) {
        setBuildNote({ version, text: "Your session has expired. Sign in again to see the preview." });
        return;
      }

      // Pick up the content fingerprint and fold it into the frame's URL, so the
      // document the user ends up looking at is provably the one built from the
      // files currently in the database.
      const next = response.headers.get("x-architect-fingerprint");
      if (!cancelled && next) setFingerprint(next);
      const note = response.headers.get("x-architect-note");
      if (note) {
        try {
          setBuildNote({ version, text: decodeURIComponent(note) });
        } catch {
          setBuildNote({ version, text: note });
        }
      } else {
        setBuildNote(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, version]);

  /*
   * A build note is not an error, and the difference matters more than it sounds.
   *
   * `compilePreview` returns `ok: true` whenever it produced a document, and puts
   * anything worth saying in `error` as *notes*: a stubbed file, an inline style
   * that will not render. Those are warnings about quality. A genuine failure
   * comes back as `ok: false`, and only that deserves the word "crash".
   *
   * The panel used to render both in one red alert, so an app that mounted
   * perfectly and looked slightly off claimed "The app crashed on load" above
   * fourteen notes about styling. The user could not see the working app because
   * the only thing the panel would tell them was a failure that had not happened.
   */
  const note = buildNote && buildNote.version === version ? buildNote.text : null;

  // "N sections not written yet" is a different failure again: a file the app
  // imports does not exist, so the screen is incomplete rather than unstyled.
  const incomplete = note?.includes("sections not written yet") ?? false;
  const blocked = note != null && !incomplete;

  // The notes that are purely about styling never cost the user their screen.
  const styleOnly = blocked && !/did not compile/.test(note) && !incomplete;

  const buildError = blocked && !styleOnly ? note : null;
  const buildWarning = blocked ? note : null;

  /*
   * "Ask the team to fix this" is a first-class action, not something the user
   * has to phrase in prose.
   *
   * Without it, a build whose entry file does not compile is a dead end: there is
   * no preview to look at, no error in the thread, and nothing to copy. The user
   * has to guess the wording that will make the agent rewrite the right file.
   *
   * It is the same pipeline the composer starts, so a repair is budgeted,
   * checkpointed and inspectable like any other run — and it carries the real
   * compiler message, so the agent is told the line rather than guessing.
   */
  const repair = async () => {
    setRepairing(true);
    setRepairError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/repair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: buildError }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setRepairError(body?.error ?? "We could not start the repair.");
        return;
      }

      // The stream is drained but not rendered here: the agent thread is where
      // the run is shown, and the preview refreshes on the next write. Draining
      // matters — an unread body leaves the request hanging.
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      setNonce((n) => n + 1);
    } catch {
      setRepairError("We could not reach the server.");
    } finally {
      setRepairing(false);
    }
  };

  // Errors thrown inside the generated app are mirrored up from the preview
  // document (see `lib/agent/preview.ts`). Without this they would only reach a
  // console nobody has open, and the panel would just be blank - the single most
  // expensive failure mode to debug, because every cause looks the same.
  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { source?: string; level?: string; text?: string } | null;
      if (!data || data.source !== "architect-preview") return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (data.level === "error") {
        setFailure({ version, text: data.text ?? "The app threw an error." });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [version]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "size-1.5 rounded-full",
              running ? "animate-live-pulse bg-volt" : "bg-success",
            )}
            aria-hidden
          />
          {running ? "building" : hasFiles ? "running" : "waiting"}
        </span>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Reload the preview"
          title="Reload"
        >
          <RefreshCw />
        </Button>

        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border p-0.5">
          {(["desktop", "tablet", "phone"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setDevice(id)}
              aria-pressed={device === id}
              className={cn(
                "rounded px-2 py-1 text-[10px] capitalize transition-colors",
                device === id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden bg-muted/30 p-4">
        <div
          className={cn(
            "mx-auto flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm",
            DEVICE_WIDTH[device],
          )}
        >
          {/*
            A warning is amber, collapsed, and never says "crash". It sits above
            the frame but stays out of the way, because the app genuinely works:
            fourteen inline-style notes on a screen that rendered are a remark
            about fidelity, not an outage. In a red alert at the top of the panel
            they pushed the user's own interface off the screen entirely, and the
            only thing the panel would tell them was a failure that had not
            happened.
          */}
          {buildWarning ? (
            <details className="border-b border-warning/30 bg-warning/5">
              <summary className="cursor-pointer list-none px-3 py-1.5 text-xs text-warning hover:bg-warning/10">
                <span className="font-medium">
                  {incomplete
                    ? "Some sections are not written yet."
                    : "This may look different from the real app."}
                </span>{" "}
                <span className="text-muted-foreground">
                  {incomplete
                    ? "The app asks for a file that does not exist yet, so those parts are placeholders."
                    : "The code is real, but some styling will not carry over. Tap to see why."}
                </span>
              </summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-warning/20 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {buildWarning}
              </pre>
            </details>
          ) : null}

          {buildError || runtimeError || repairError ? (
            <div
              role="alert"
              className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium text-destructive">
                  {repairError
                    ? "The repair could not start."
                    : runtimeError
                      ? "The app crashed on load."
                      : "Part of this app did not compile."}
                </span>{" "}
                <span className="text-muted-foreground">
                  {repairError
                    ? "Nothing was changed."
                    : runtimeError
                      ? "This is the real error from your app, sent up from the preview."
                      : "The rest of the app is running below."}
                </span>
                {buildError || runtimeError ? (
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                    {buildError ?? runtimeError}
                  </pre>
                ) : null}
              </span>
              {buildError && !runtimeError ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={repair}
                  disabled={repairing}
                  className="shrink-0"
                >
                  {repairing ? "Fixing…" : "Ask the team to fix it"}
                </Button>
              ) : null}
            </div>
          ) : null}
          {hasFiles ? (
            <iframe
              key={version}
              ref={iframeRef}
              title="Generated app preview"
              src={src}
              // The generated app is untrusted by construction: it is model output
              // nobody has read. The trade-off is deliberate and worth stating
              // plainly, because it is a real trade-off rather than a free win:
              //
              //   - `allow-same-origin` is REQUIRED. Almost any real app touches
              //     localStorage during its first render, and in a sandbox without
              //     it every access throws SecurityError, React tears the tree down,
              //     and the user gets a blank white frame with no explanation.
              //     A blank preview with no message is a worse failure than the
              //     risk below, so storage is allowed.
              //   - The cost is that the frame is same-origin, so generated code
              //     could read this app's cookies. It is NOT neutralised: the
              //     preview route authenticates via cookie (see route.ts), so a
              //     hostile generated file would sit on the same origin as a
              //     signed-in session.
              //
              // For a production build the fix is to serve previews from a
              // separate, cookie-less origin. That is the correct architecture and
              // it is a deployment change, not a one-line fix, so it is recorded
              // here rather than silently pretended away. It is also why errors
              // are mirrored to the parent below: an exception inside a nested
              // browsing context is otherwise invisible unless you have the frame's
              // devtools open, which is exactly how this bug survived several
              // rounds of "it renders fine for me".
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
              className="h-full w-full border-0 bg-background"
            />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center">
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-medium">Nothing to preview yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Describe what you want in the panel on the left. The agent will
                  write the files and the app will appear here, running for real.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
