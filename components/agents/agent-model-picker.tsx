"use client";

/**
 * Choose which model runs one agent.
 *
 * Developer lens only. Simple mode has no access to this control at all, which
 * is the point: the brief says the two lenses show the *same* graph with plain
 * labels and no model or config controls, so the control is absent rather than
 * disabled.
 *
 * "Auto" clears the override rather than storing a model id, so the agent falls
 * back to the provider default. That is a different thing from pinning a model,
 * and conflating them would make a later change to the default invisible on
 * projects that had "touched" the setting without meaning to.
 *
 * The change applies to the **next** run, not the current one. A run already
 * streaming is mid-flight; swapping its model would mean restarting it, and
 * silently changing which model is writing your files is worse than waiting.
 */

import * as React from "react";

import { MODELS } from "@/lib/agent/provider";

export function AgentModelPicker({
  projectId,
  agentKey,
  current,
  onChanged,
}: {
  projectId: string;
  agentKey: string;
  /** The override, or undefined when the agent is on auto. */
  current: string | undefined;
  onChanged: (model: string | undefined) => void;
}) {
  const [value, setValue] = React.useState(current ?? "auto");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-sync when the server value changes underneath us, so the control never
  // shows a selection that was not saved. Done during render rather than in an
  // effect: an effect would render the stale value once before correcting it,
  // and the lint rule that flags it is pointing at a real flicker.
  const [syncedFrom, setSyncedFrom] = React.useState(current);
  if (syncedFrom !== current) {
    setSyncedFrom(current);
    setValue(current ?? "auto");
  }

  async function choose(next: string) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/agents`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentKey,
          model: next === "auto" ? null : next,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setValue(previous);
        setError(body?.error ?? "We could not save that.");
        return;
      }

      onChanged(next === "auto" ? undefined : next);
    } catch {
      setValue(previous);
      setError("We could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const id = `model-${agentKey}`;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-micro text-muted-foreground"
      >
        Model for this agent
        {saving ? <span aria-live="polite">saving…</span> : null}
      </label>
      <select
        id={id}
        value={value}
        disabled={saving}
        onChange={(event) => void choose(event.target.value)}
        className="h-7 rounded-md border border-border bg-background px-2 font-mono text-micro disabled:opacity-60"
      >
        <option value="auto">auto (provider default)</option>
        {MODELS.map((model) => (
          <option key={model.id} value={model.id} title={model.note}>
            {model.label}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-micro text-destructive">
          {error}
        </p>
      ) : null}
      <p className="text-micro text-muted-foreground">
        Applies to the next run. The current one is already in flight.
      </p>
    </div>
  );
}
