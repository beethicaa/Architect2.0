/**
 * Live probe: run the first two agents of the real pipeline against Groq.
 *
 * Not a mock and not a unit test — it calls the same `createProvider` the
 * pipeline uses, with the same prompts, and reports what actually came back.
 * Run with:
 *   node --experimental-strip-types --no-warnings --import=./scripts/alias-register.mjs scripts/probe-pipeline.mjs
 */

import { readFileSync } from "node:fs";

// Load .env.local into process.env before importing anything that reads it.
// A plain `import` of the provider runs at module-eval time, so the assignment
// has to happen first — hence the dynamic import below.
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && !match[2].startsWith("#")) {
    process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
}

const { createProvider, DEFAULT_MODEL } = await import("@/lib/agent/provider");

/** @type {Record<string, string>} */

const PROMPTS = {
  planner: [
    "You are one specialist on a team of seven building an app. You do one job.",
    "",
    "RULES:",
    "- Take every specific detail in the request seriously.",
    "- Write real, specific copy in their voice. Never \"Item 1\" or \"Lorem ipsum\".",
    "- Build exactly the scope they asked for.",
    "",
    "YOUR JOB: the Planner. Read the request and produce the spec the rest of the team builds from.",
    "",
    "Produce: 1) a one-sentence restatement, 2) the screens, 3) what the app needs to remember,",
    "4) anything ambiguous and the reading you chose.",
    "",
    "THE REQUEST: an app where I store my subject-wise notes, and it generates MCQ questions",
    "for my quizzes and flashcards for revision of each subject.",
    "",
    "FILES THAT EXIST SO FAR: none yet",
  ].join("\n"),

  researcher: [
    "You are one specialist on a team of seven building an app. You do one job.",
    "YOUR JOB: the Researcher. Look at how apps like this are built.",
    "",
    "You have no internet access, so reason from patterns you know.",
    "",
    "Produce 1) three to five specific patterns, 2) the one you will follow and why it fits",
    "THIS app, 3) anything to avoid.",
    "",
    "THE REQUEST: subject-wise notes with MCQ generation and flashcards for revision",
  ].join("\n"),

  data_schema: [
    "You are one specialist on a team of seven building an app. You do one job.",
    "YOUR JOB: the Data Agent (schema). Decide what the app needs to remember.",
    "",
    "First, plain language about what is stored and why.",
    "",
    "Then one fenced SQL block:",
    "",
    "```sql",
    "create table entries (",
    "  id uuid primary key default gen_random_uuid()",
    ");",
    "```",
    "",
    "Rules: Postgres syntax. Every table gets id, created_at, updated_at. snake_case columns.",
    "Add the foreign keys the app genuinely needs and no more.",
    "",
    "THE REQUEST: subject-wise notes with MCQ generation and flashcards for revision",
  ].join("\n"),

  data_wiring: "",
  interface: "",
  reviewer: "",
  shipper: "",
};

const keys = ["planner", "researcher", "data_schema"];

for (const key of keys) {
  const provider = createProvider(DEFAULT_MODEL);
  const started = Date.now();

  const result = await provider.stream(
    [
      { role: "system", content: PROMPTS[key] },
    ],
    [],
    () => undefined,
    2_500,
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const total = result.usage.input + result.usage.output;
  const head = result.text.slice(0, 220).replace(/\s+/g, " ");

  console.log(
    `\n=== ${key.toUpperCase()} ===`,
    `ok=${result.text.length > 0}`,
    `${seconds}s`,
    `in=${result.usage.input} out=${result.usage.output} total=${total}`,
    `model=${provider.model}`,
  );
  console.log(head);

  // A schema agent that returns no SQL would be a real failure worth catching
  // here rather than in the UI.
  if (key === "data_schema" && !/create table/i.test(result.text)) {
    console.log("  !! no SQL block returned");
  }
}

console.log("\nPROBE COMPLETE");
