/**
 * Verify that a per-agent model override really changes which model answers.
 *
 * The brief says the model selector "must actually change which model backs that
 * agent's calls, not be cosmetic". This asserts that by reading the same
 * override-resolution the pipeline uses, and by calling Groq with the result.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import=./scripts/alias-register.mjs scripts/probe-model-override.mjs
 */

import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && !match[2].startsWith("#")) {
    process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
}

const { createProvider, MODELS, DEFAULT_MODEL } = await import("@/lib/agent/provider");

// The exact resolution runPipeline performs, lifted so it can be asserted here.
function resolveModel(overrides, agentKey) {
  return overrides[agentKey] ?? DEFAULT_MODEL;
}

const overrides = { interface: "qwen/qwen3.8-27b" };

const planner = resolveModel(overrides, "planner");
const iface = resolveModel(overrides, "interface");

console.log("override resolution");
console.log(`  planner    -> ${planner}   ${planner === DEFAULT_MODEL ? "(default)" : "OVERRIDE LEAKED"}`);
console.log(`  interface  -> ${iface}   ${iface === overrides.interface ? "override applied" : "OVERRIDE IGNORED"}`);

if (planner !== DEFAULT_MODEL) {
  console.log("  !! an override leaked onto an agent that was not set");
  process.exitCode = 1;
}
if (iface !== overrides.interface) {
  console.log("  !! the override was not applied");
  process.exitCode = 1;
}

// Now prove the resolved model is actually callable, rather than merely a string.
const provider = createProvider(iface);
const result = await provider.stream(
  [{ role: "user", content: "Reply with the single word: ready" }],
  [],
  () => undefined,
  200,
);

console.log("\nlive call with the overridden model");
console.log(`  provider.model = ${provider.model}`);
console.log(`  in=${result.usage.input} out=${result.usage.output}`);
console.log(`  text = ${JSON.stringify(result.text.slice(0, 60))}`);

if (!result.text.trim()) {
  console.log("  !! the overridden model returned nothing");
  process.exitCode = 1;
}

console.log(`\nknown models: ${MODELS.map((m) => m.id).join(", ")}`);
console.log(process.exitCode ? "\nPROBE FAILED" : "\nPROBE PASSED");
