/**
 * The pipeline's vocabulary.
 *
 * Seven agents, in a fixed order, each with exactly one job. This module is the
 * single source of that order, and everything else derives from it: the graph
 * component, the chat blocks, the run loop, the inspector and the copy
 * dictionary. Adding an eighth agent means editing this array, not hunting
 * through the UI for seven hardcoded lists that have to agree.
 *
 * The two naming fields on each agent are the whole dual-audience mechanic in
 * miniature. `working` is what a non-technical user reads; `technicalWorking` is
 * what a developer reads. They are declared together, adjacent, so the two can
 * never drift apart in wording — which is the failure the brief calls out:
 * "plain-language status is mandatory for every single action, even technical
 * ones happening under the hood".
 */

export const AGENT_KEYS = [
  "planner",
  "researcher",
  "data_schema",
  "data_wiring",
  "interface",
  "reviewer",
  "shipper",
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

/** The pipeline is fixed order, so the index is the position in the run. */
export type AgentIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AgentSpec {
  key: AgentKey;
  /** Proper name, shown in both lenses. */
  name: string;
  /** One-line job, plain language. */
  role: string;
  /** The same job as an engineer would describe it. */
  technicalRole: string;
  /** What the user sees while this agent works. */
  working: string;
  /** The same moment in developer terms. */
  technicalWorking: string;
  /** Indices of agents that must finish first. */
  dependsOn: AgentIndex[];
  /** The key into the agent's artifact payload. */
  artifact: string;
  /**
   * Whether this agent writes files. Only Data (wiring) and Interface do; the
   * other five produce artifacts. That distinction is what makes "the plan
   * exists but no code does yet" a visible state rather than a bug.
   */
  writes: boolean;
}

export const AGENTS: readonly AgentSpec[] = [
  {
    key: "planner",
    name: "Planner",
    role: "Reads what you asked for and works out what to build.",
    technicalRole: "Decomposes the request into a spec: screens, entities, routes and acceptance criteria.",
    working: "reading your request and working out what to build",
    technicalWorking: "decomposing the request into a spec",
    dependsOn: [],
    artifact: "plan",
    writes: false,
  },
  {
    key: "researcher",
    name: "Researcher",
    role: "Looks at how similar things are built before anything is generated.",
    technicalRole: "Surveys prior art and library choices; records the patterns it will follow.",
    working: "looking at how similar apps are built",
    technicalWorking: "surveying prior art and dependency choices",
    dependsOn: [0],
    artifact: "notes",
    writes: false,
  },
  {
    key: "data_schema",
    name: "Data Agent",
    role: "Decides what your app needs to remember.",
    technicalRole: "Designs the data model: tables, columns, types, constraints and relations.",
    working: "deciding what your app needs to remember",
    technicalWorking: "designing the schema (tables, columns, relations)",
    dependsOn: [0, 1],
    artifact: "schema",
    writes: false,
  },
  {
    key: "data_wiring",
    name: "Data Agent",
    role: "Connects the screens to real, saved data.",
    technicalRole: "Binds UI state to persisted records; writes the storage layer and CRUD bindings.",
    working: "connecting the screens to real, saved data",
    technicalWorking: "wiring UI state to the persistence layer",
    dependsOn: [2],
    artifact: "bindings",
    writes: true,
  },
  {
    key: "interface",
    name: "Interface Agent",
    role: "Builds the screens you can click on.",
    technicalRole: "Implements the components, layout and interaction for each screen in the spec.",
    working: "building the screens you can click on",
    technicalWorking: "implementing components and layout",
    dependsOn: [1, 3],
    artifact: "screens",
    writes: true,
  },
  {
    key: "reviewer",
    name: "Reviewer",
    role: "Tries to break what was built, then explains anything it finds.",
    technicalRole: "Audits the build; flags defects with severity and either auto-fixes or escalates.",
    working: "trying to break what was built",
    technicalWorking: "auditing the build for defects",
    dependsOn: [4],
    artifact: "findings",
    writes: false,
  },
  {
    key: "shipper",
    name: "Shipper",
    role: "Puts it online and hands you the link.",
    technicalRole: "Deploys the build and returns a live URL with deployment logs.",
    working: "putting it online",
    technicalWorking: "deploying the build",
    dependsOn: [5],
    artifact: "deployment",
    writes: false,
  },
] as const;

/** The stage a run is on, or the resting states around it. */
export type PipelineStage =
  | "idle"
  | "planning"
  | "researching"
  | "modelling"
  | "wiring"
  | "building"
  | "reviewing"
  | "shipping"
  | "awaiting-approval"
  | "complete"
  | "failed";

export const STAGE_FOR_AGENT: Record<AgentKey, PipelineStage> = {
  planner: "planning",
  researcher: "researching",
  data_schema: "modelling",
  data_wiring: "wiring",
  interface: "building",
  reviewer: "reviewing",
  shipper: "shipping",
};

/** Fast lookup by key. AGENTS is static, so this is built once. */
export const AGENT_BY_KEY: Record<AgentKey, AgentSpec> = Object.fromEntries(
  AGENTS.map((agent) => [agent.key, agent]),
) as Record<AgentKey, AgentSpec>;

/** The index of each agent in the fixed order. */
export const AGENT_INDEX: Record<AgentKey, AgentIndex> = Object.fromEntries(
  AGENTS.map((agent, index) => [agent.key, index as AgentIndex]),
) as Record<AgentKey, AgentIndex>;

/**
 * Plain-language copy for technical actions.
 *
 * Section 4 requires a copy dictionary rather than ad-hoc strings, and this is
 * it. Keyed by an action name, not by a sentence, so the same event reads the
 * same way in the chat, the graph and the notification centre.
 *
 * Anything technical that happens under the hood gets an entry here. Writing a
 * technical string inline in a component is the signal to add it here instead —
 * otherwise the two lenses start disagreeing, which is exactly what the brief
 * forbids.
 */
export const PLAIN_COPY = {
  "provisioning-database": "Setting up your app's storage",
  "provisioning-auth": "Setting up sign-in",
  "compiling-bundle": "Turning the code into something you can click",
  "installing-dependencies": "Getting the building blocks it needs",
  "resolving-imports": "Connecting the files together",
  "type-checking": "Checking everything fits",
  "linting": "Checking for mistakes",
  "running-tests": "Testing it works",
  "pushing-commit": "Saving your changes",
  "creating-branch": "Making a safe branch for the changes",
  "creating-pr": "Preparing the changes for review",
  "querying-api": "Asking GitHub about your repository",
  "reading-tree": "Reading the shape of your codebase",
  "detecting-framework": "Working out what it is built with",
  "uploading-source": "Uploading the code",
  "starting-build": "Starting the build",
  "awaiting-build": "Waiting for the build to finish",
  "allocating-url": "Getting you a web address",
  "verifying-url": "Checking the address works",
} as const satisfies Record<string, string>;

/** The same events, worded for a developer. */
export const TECHNICAL_COPY = {
  "provisioning-database": "Provisioning the Postgres schema",
  "provisioning-auth": "Configuring the auth provider",
  "compiling-bundle": "Bundling the generated source with esbuild",
  "installing-dependencies": "Resolving the dependency graph",
  "resolving-imports": "Resolving relative imports against the project file table",
  "type-checking": "Running tsc over the generated source",
  "linting": "Running ESLint over the generated source",
  "running-tests": "Executing the test suite",
  "pushing-commit": "Creating a commit via the Git Data API",
  "creating-branch": "Creating a ref under refs/heads",
  "creating-pr": "Opening a pull request",
  "querying-api": "Calling the GitHub REST API",
  "reading-tree": "Walking the git tree recursively",
  "detecting-framework": "Detecting the stack from manifests",
  "uploading-source": "Writing blobs through the Git Data API",
  "starting-build": "Creating the deployment",
  "awaiting-build": "Polling the deployment status",
  "allocating-url": "Reading the assigned alias",
  "verifying-url": "GETting the deployment URL",
} as const satisfies Record<keyof typeof PLAIN_COPY, string>;

/** Word an event for a lens. An unknown action passes through, which is honest. */
export function copyFor(
  action: string,
  lens: "simple" | "developer",
): string {
  if (lens === "developer") {
    return TECHNICAL_COPY[action as keyof typeof TECHNICAL_COPY] ?? action;
  }
  return PLAIN_COPY[action as keyof typeof PLAIN_COPY] ?? action;
}
