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

import { compilePreview } from "@/lib/agent/preview";
import { listFiles } from "@/lib/agent/tools";
import { createClient } from "@/lib/supabase/server";
import { base64, deploymentName, type DeployFile } from "@/lib/deploy/vercel";

/** Vercel rejects an oversized inline file; skip it rather than fail the deploy. */
const MAX_FILE_BYTES = 4_000_000;

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
