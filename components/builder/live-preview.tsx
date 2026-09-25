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
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // The error is stored against the build it came from rather than cleared in an
  // effect: a new build is a new `version`, so the stale message simply stops
  // matching. Clearing on a timer would also be wrong here - the two requests can
  // land out of order, and the older failure would win.
  const [failure, setFailure] = React.useState<{ version: number; text: string } | null>(null);

  // The agent hook bumps `refresh` on every write; a manual reload adds to it so
  // both paths invalidate the same cache key.
  const version = refresh + nonce;
  const src = `/api/projects/${projectId}/preview?v=${version}`;
  const runtimeError = failure && failure.version === version ? failure.text : null;

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
          {runtimeError ? (
            <div
              role="alert"
              className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium text-destructive">The app crashed on load.</span>{" "}
                <span className="text-muted-foreground">
                  This is the real error from your app, sent up from the preview.
                </span>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                  {runtimeError}
                </pre>
              </span>
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
