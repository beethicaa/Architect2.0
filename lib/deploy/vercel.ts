/**
 * The Vercel deployment client.
 *
 * A generated app is a self-contained React bundle, not a Next.js project, so
 * there is no build step to run. That makes the deployment simpler than it
 * sounds: the compiled document *is* the site.
 *
 * What actually goes up:
 *
 *   index.html   the compiled app - React bundled in, Tailwind inlined. This is
 *                the live URL, and it is the real output, not a screenshot.
 *   source/...   every generated file, so the deployed URL doubles as somewhere
 *                the code can be read. Cheap, and it makes the URL worth sharing
 *                with a developer.
 *   README.md    what this deployment is.
 *
 * `projectSettings` deliberately sends no framework and no build command. Setting
 * either makes Vercel try to build, and a build of an already-built document
 * fails - which would surface as a build error on a deployment that was correct.
 */

import { vercelEnv } from "@/lib/env";

const API = "https://api.vercel.com";

export interface DeployFile {
  /** Path inside the deployment, e.g. "index.html". */
  file: string;
  data: string;
  encoding: "base64";
}

export interface DeploymentRequest {
  files: DeployFile[];
  /** Vercel project name. Must be unique within the account. */
  name: string;
  target: "production" | "preview";
}

export interface DeploymentCreated {
  id: string;
  /** Per-build hostname. Useful in logs; not the URL to share. */
  url: string;
  /**
   * The project name, which is the stable alias on Vercel.
   *
   * This is the field that matters for the link the user gets. See the note in
   * the deploy route about why the per-build hostname is the wrong thing to store.
   */
  name?: string;
  readyState: string;
}

export interface DeploymentStatus {
  id: string;
  url: string;
  readyState: string;
  error?: string;
  /**
   * The Vercel project, once it has been created.
   *
   * This is what makes the shareable URL knowable: the alias is a property of the
   * project, and the project id is not available until Vercel has made one.
   */
  projectId?: string;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${vercelEnv.token}`,
    "Content-Type": "application/json",
  };
}

/** Vercel scopes by team when the token belongs to one. */
function scope(): string {
  return vercelEnv.teamId ? `?teamId=${encodeURIComponent(vercelEnv.teamId)}` : "";
}

export async function createDeployment(
  request: DeploymentRequest,
): Promise<DeploymentCreated> {
  const response = await fetch(`${API}/v13/deployments${scope()}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: request.name,
      target: request.target,
      files: request.files,
      // No framework, no build command: the document is already built.
      projectSettings: {
        framework: null,
        buildCommand: null,
        outputDirectory: null,
        installCommand: null,
      },
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | (DeploymentCreated & { name?: string; error?: { message?: string } })
    | null;

  if (!response.ok || !body?.id) {
    throw new Error(
      body?.error?.message ??
        `Vercel rejected the deployment (HTTP ${response.status}).`,
    );
  }

  return {
    id: body.id,
    url: body.url,
    name: typeof body.name === "string" ? body.name : undefined,
    readyState: body.readyState,
  };
}

export async function getDeployment(id: string): Promise<DeploymentStatus> {
  const response = await fetch(`${API}/v13/deployments/${id}${scope()}`, {
    headers: headers(),
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as
    | (DeploymentStatus & { projectId?: string; error?: { message?: string } })
    | null;

  if (!response.ok || !body) {
    throw new Error(
      body?.error?.message ??
        `Could not read the deployment status (HTTP ${response.status}).`,
    );
  }

  return {
    id: body.id,
    url: body.url,
    readyState: body.readyState,
    error: body.error,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
  };
}

export const READY_STATES = new Set(["READY"]);
export const FAILED_STATES = new Set(["ERROR", "CANCELED"]);

/**
 * A Vercel project name, derived from ours.
 *
 * The binding limit is not Vercel's name limit - it is the *alias*. Vercel serves
 * a project at `<name>.vercel.app` and silently truncates that host to 32
 * characters, so a longer name ends up with an alias that is not the name:
 *
 *   name    simple-habit-tracker-users-habit-2bab5936
 *   alias   simple-habit-tracker-users-habit-2b.vercel.app
 *
 * Building the URL from the name then 404s, which is exactly what happened on a
 * real deploy: the link was stored, shown as Live, and returned
 * DEPLOYMENT_NOT_FOUND. The id suffix is only there to keep names unique, so it
 * gets whatever room is left rather than a fixed share.
 */
export function deploymentName(projectName: string, projectId: string): string {
  const suffix = projectId.replace(/-/g, "").slice(0, 8);
  const room = ALIAS_BUDGET - suffix.length - 1;
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, room);
  return `${slug || "app"}-${suffix}`;
}

/** Vercel truncates the alias host at 32 characters, before `.vercel.app`. */
const ALIAS_BUDGET = 32;

/** The canonical, shareable URL for a deployment. */
export function canonicalUrl(name: string | undefined, hostname: string): string {
  return name ? `https://${name}.vercel.app` : `https://${hostname}`;
}

/**
 * The alias Vercel actually assigned to a project, if it has one.
 *
 * Reading this beats deriving the URL from the name, because Vercel truncates
 * the alias host to 32 characters. A project called
 * `simple-habit-tracker-users-habit-2bab5936` is served at
 * `simple-habit-tracker-users-habit-2b.vercel.app`, and the difference is a 404.
 *
 * Returns null rather than guessing: a wrong URL shown as "Live" is worse than
 * no URL, so the caller keeps what it has until the alias is knowable.
 */
export async function getProjectAlias(projectId: string): Promise<string | null> {
  const response = await fetch(`${API}/v9/projects/${projectId}${scope()}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    targets?: { production?: { alias?: string[] } };
  } | null;

  const alias = body?.targets?.production?.alias;
  if (!Array.isArray(alias) || alias.length === 0) return null;

  // The bare alias is `name.vercel.app` (two labels); the account-scoped one is
  // `name-account.vercel.app` (three). Counting labels avoids hardcoding an
  // account name, which would be wrong on every other user's account.
  const bare = [...alias].sort(
    (a, b) => a.split(".").length - b.split(".").length,
  )[0];

  return `https://${bare}`;
}

export function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
