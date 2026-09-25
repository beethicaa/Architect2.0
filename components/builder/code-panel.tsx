"use client";

/**
 * The code view: the agent's real files, read from Postgres.
 *
 * Two decisions worth stating:
 *  - **It shows a real diff.** `prev_lines` is captured by the write tool before
 *    the upsert, so the +/- counts are computed, not invented. An agentic
 *    builder's scariest moment is "what did it change behind my back?".
 *  - **It is one tab away in the simple lens, never required.** Code being
 *    *available* is what makes the simple view honest; code being *forced* would
 *    make it a fake.
 */

import { FileCode2, FolderTree } from "lucide-react";
import * as React from "react";

import { EmptyState } from "@/components/states/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProjectFile } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

function linesOf(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length;
}

export function CodePanel({
  files,
  activePaths,
  className,
}: {
  files: ProjectFile[];
  /** Paths just written, so the newest change is obvious. */
  activePaths: string[];
  className?: string;
}) {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const selected =
    files.find((file) => file.path === selectedPath) ?? files[files.length - 1];

  if (files.length === 0) {
    return (
      <EmptyState
        icon={FileCode2}
        title="No files yet"
        hint="The agent writes real files as it works. They appear here the moment they land."
        className="border-0 px-0"
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FolderTree className="size-3.5" aria-hidden />
        {files.length} real {files.length === 1 ? "file" : "files"}
      </p>

      <ul className="flex flex-col gap-1">
        {files.map((file) => {
          const active = selected?.path === file.path;
          const delta = linesOf(file.content) - file.prev_lines;
          const isNew = activePaths.includes(file.path);
          return (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => setSelectedPath(file.path)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-micro transition-colors",
                  active ? "bg-muted text-foreground" : "hover:bg-muted/50",
                )}
              >
                <span className="truncate">{file.path}</span>
                {isNew ? (
                  <span className="shrink-0 rounded bg-volt/15 px-1 text-[10px] text-volt">
                    new
                  </span>
                ) : null}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {delta > 0 ? (
                    <span className="text-success">+{delta}</span>
                  ) : delta < 0 ? (
                    <span className="text-destructive">{delta}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected ? (
        <div className="flex flex-col gap-2">
          <span className="truncate font-mono text-micro text-muted-foreground">
            {selected.path}
          </span>
          <ScrollArea className="max-h-72 rounded-lg border border-border">
            <pre className="p-3 font-mono text-micro leading-relaxed">
              {selected.content.split("\n").map((line, index) => (
                <div key={`${index}-${line.slice(0, 8)}`} className="flex gap-3">
                  <span className="w-5 shrink-0 select-none text-right text-muted-foreground/60">
                    {index + 1}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-all text-foreground">
                    {line}
                  </span>
                </div>
              ))}
            </pre>
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
