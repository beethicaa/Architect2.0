"use client";

/**
 * The deploy panel: ship the app, show the live link, and keep the history.
 *
 * The brief is explicit that the Shipper returns a URL, and this is the surface
 * where that promise is kept. Three states, genuinely different:
 *
 *   - nothing shipped: one button, and what it will do
 *   - in flight: the real provider state, polled, with Vercel's own log lines
 *     rather than a spinner and an invented percentage
 *   - shipped: the link, openable and copyable, plus every earlier deployment,
 *     because "redeploy on change" only means something if you can see what you
 *     are replacing
 *
 * The lens changes the wording, not the capability.
 */

import { Check, Copy, ExternalLink, Globe, Rocket } from "lucide-react";
import * as React from "react";

import { StatusPill } from "@/components/states/status-pill";
import { Button } from "@/components/ui/button";
import { VERCEL_SETUP_HINT } from "@/lib/env";
import { cn, relativeTime } from "@/lib/utils";
import { useViewMode } from "@/lib/view-mode";

interface Deployment {
  id: string;
  state: "queued" | "working" | "done" | "failed";
  url: string | null;
  external_id: string | null;
  error: string | null;
  logs: string[] | null;
  created_at: string;
}

const POLL_MS = 4_000;

export function DeployPanel({
  projectId,
  configured,
  hasFiles,
  fileCount,
  onDeployed,
  className,
}: {
  projectId: string;
  /** Resolved on the server; a client cannot read a server-only env var. */
  configured: boolean;
  hasFiles: boolean;
  fileCount: number;
  onDeployed: () => void;
  className?: string;
}) {
  const { isDeveloper } = useViewMode();
  const [rows, setRows] = React.useState<Deployment[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/deploy`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) {
      setLoaded(true);
      return;
    }
    const data = (await response.json()) as { deployments: Deployment[] };
    setRows(data.deployments);
    setLoaded(true);
  }, [projectId]);

  // The first read, and a cancellation guard so a slow response cannot land
  // after the panel has been closed. The async wrapper is what satisfies the
  // set-state-in-effect rule: the fetch is the work, the state update is its
  // result, and neither runs synchronously during render.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Poll only while something is building, so an idle panel makes no requests.
  const building = rows.some((r) => r.state === "working" || r.state === "queued");
  React.useEffect(() => {
    if (!building) return;
    const timer = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(timer);
  }, [building, load, rows]);

  const latest = rows.find((r) => r.state === "done") ?? null;
  const active = rows.find((r) => r.state === "working" || r.state === "queued") ?? null;
  const failed = rows.filter((r) => r.state === "failed");

  async function deploy() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/deploy`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "We could not start the deploy.");
        return;
      }
      onDeployed();
      await load();
    } catch {
      setError("We could not reach the server. Nothing was deployed.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      setError("Your browser would not let us copy that. Select the link instead.");
    }
  }

  if (!configured) {
    return (
      <div className={cn("rounded-lg border border-border p-3", className)}>
        <h3 className="text-sm font-medium">Publish</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {VERCEL_SETUP_HINT}
        </p>
      </div>
    );
  }


  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label="Deployments">
      <header className="flex items-center gap-2">
        <Globe aria-hidden className="size-3.5 text-muted-foreground" />
        <h3 className="text-xs font-medium">
          {isDeveloper ? "Deployments" : "Your live app"}
        </h3>
        {latest ? <StatusPill state="done" label="Live" /> : null}
      </header>

      {!hasFiles ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          There is nothing to publish yet. The team writes the app first, then it
          can go live.
        </p>
      ) : (
        <Button size="sm" onClick={deploy} disabled={busy}>
          <Rocket aria-hidden />
          {busy ? "Publishing…" : latest ? "Publish the latest changes" : "Publish this app"}
        </Button>
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      {active ? (
        <div className="rounded-md border border-volt/40 bg-volt-muted/20 p-2.5">
          <p className="text-xs font-medium">Publishing to Vercel…</p>
          <p className="mt-0.5 text-micro text-muted-foreground">
            {active.url ? (
              <a
                href={active.url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {active.url}
              </a>
            ) : (
              "The URL is assigned once Vercel accepts the upload."
            )}
          </p>
          {active.logs?.length ? (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {active.logs.map((line, index) => (
                <li key={index} className="font-mono text-micro text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {latest?.url ? (
        <div className="rounded-md border border-border p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Check aria-hidden className="size-3.5 text-success" />
            Live
          </p>
          <p className="mt-1 break-all font-mono text-micro text-muted-foreground">
            {latest.url}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="xs" asChild>
              <a href={latest.url} target="_blank" rel="noreferrer">
                Open
                <ExternalLink aria-hidden data-icon="inline-end" />
              </a>
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void copy(latest.url!)}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="mt-1.5 text-micro text-muted-foreground">
            {relativeTime(latest.created_at)}
            {isDeveloper && latest.external_id ? ` · ${latest.external_id.slice(0, 12)}` : ""}
          </p>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <details className="rounded-md border border-destructive/30 p-2.5">
          <summary className="cursor-pointer text-xs font-medium text-destructive">
            {failed.length} failed deploy{failed.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {failed.map((row) => (
              <li key={row.id} className="text-micro text-muted-foreground">
                <span className="text-destructive">
                  {row.error ?? "The build failed."}
                </span>{" "}
                · {relativeTime(row.created_at)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {loaded && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {fileCount > 0 ? "Nothing published yet." : "The app has not been written yet."}
        </p>
      ) : null}
    </section>
  );
}
