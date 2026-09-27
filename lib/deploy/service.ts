/**
 * Turning a project into something Vercel can host.
 *
 * The important decision is what gets deployed. A generated app is a standalone
 * React bundle with Tailwind inlined - the same document the preview iframe
 * loads - so that document *is* the site. There is no source to build, no
 * package.json to install and no framework for Vercel to detect.
 *
 * That is worth stating plainly, because "the deployed app is the preview
 * document" is either a shortcut or a fake depending on intent. It is a shortcut
 * here, and it is honest: the bytes served at the live URL are the bytes the
 * user's own code compiled to. The source travels with it, so the URL is also a
 * place to read what the agents wrote.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { compilePreview } from "@/lib/agent/preview";
import { listFiles } from "@/lib/agent/tools";
import { createClient } from "@/lib/supabase/server";
import { base64, deploymentName, type DeployFile } from "@/lib/deploy/vercel";

/** Vercel rejects an oversized inline file; skip it rather than fail the deploy. */
const MAX_FILE_BYTES = 4_000_000;

/**
 * Where the preview document expects its React runtime to live.
 *
 * The compiled document imports it as an absolute path, because in the preview
 * that path is served by Architect itself. A deployment does not have Architect:
 * only the files in `files` below are shipped, so an absolute import of a file
 * nobody deployed is a 404, the module never evaluates, the app never mounts, and
 * the live URL is a blank page.
 *
 * That is exactly what a deployed build did - `GET /preview/react-runtime.js`
 * returned 404 while `/` returned a complete 30KB document with correct Tailwind.
 * The document was fine; one of its imports was not there.
 *
 * So the runtime travels with the deployment, at the same absolute path the
 * document asks for. It is the same file the preview uses, so what is deployed
 * and what was previewed are byte-identical in behaviour.
 */
const RUNTIME_PATH = "preview/react-runtime.js";

/** Read the pre-bundled React from disk, or null if the build step did not run. */
function readRuntime(): string | null {
  const local = path.join(process.cwd(), "public", RUNTIME_PATH);
  if (!existsSync(local)) return null;
  return readFileSync(local, "utf8");
}

export interface Deployable {
  name: string;
  files: DeployFile[];
  /** Set when the app could not be compiled, so nothing is shipped. */
  problem: string | null;
}

export async function buildDeployment(
  projectId: string,
  projectName: string,
): Promise<Deployable> {
  const supabase = await createClient();
  const records = await listFiles(supabase, projectId);

  const result = await compilePreview(records);
  if (!result.ok) {
    return {
      name: deploymentName(projectName, projectId),
      files: [],
      problem: result.error ?? "The app did not compile, so there is nothing to deploy.",
    };
  }

  const files: DeployFile[] = [
    { file: "index.html", data: base64(result.html), encoding: "base64" },
  ];

  /*
   * The React runtime, at the exact path the document imports.
   *
   * Shipping without it produces a deployment that serves a complete, correctly
   * styled document and then does nothing: the module 404s, so the bundle never
   * runs and the root element stays empty. Nothing in the response says why - the
   * page is 200 and looks fine in the source - which is why this needs to be an
   * error rather than a silent omission.
   */
  const runtime = readRuntime();
  if (!runtime) {
    return {
      name: deploymentName(projectName, projectId),
      files: [],
      problem:
        "The React runtime is missing from this build, so a deployed app could not run. " +
        "It is built by the prebuild step (npm run build).",
    };
  }
  files.push({ file: RUNTIME_PATH, data: base64(runtime), encoding: "base64" });

  for (const record of records) {
    if (Buffer.byteLength(record.content, "utf8") > MAX_FILE_BYTES) continue;
    files.push({
      file: `source/${record.path}`,
      data: base64(record.content),
      encoding: "base64",
    });
  }

  files.push({
    file: "README.md",
    data: base64(
      [
        `# ${projectName}`,
        "",
        "Deployed by Architect 2.0 from a description in plain language.",
        "",
        "- `index.html` is the running app: the generated React bundle with its",
        "  Tailwind CSS inlined. It is a static document, so there is no build",
        "  step and no server.",
        "- `source/` holds every file the agents wrote.",
        "",
        `Built from ${records.length} file(s).`,
      ].join("\n"),
    ),
    encoding: "base64",
  });

  return {
    name: deploymentName(projectName, projectId),
    files,
    problem: result.error,
  };
}
