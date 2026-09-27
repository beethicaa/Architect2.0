/**
 * Hand-written Supabase schema types for the REAL slice of Architect 2.0.
 *
 * Everything else in the product (agents, code generation, GitHub, deploys) is
 * mocked, so there is no second type source to keep in sync. If the schema
 * changes, prefer regenerating with:
 *
 *   npx supabase gen types typescript --project-id <id> --schema public \
 *     > lib/supabase/types.ts
 *
 * The structure mirrors the generator's output on purpose, so a future
 * regeneration is a drop-in replacement.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** A project either starts from a prompt or is imported from a repo. */
export type ProjectOrigin = "prompt" | "import";

export type ProjectStatus =
  | "draft"
  | "building"
  | "ready"
  | "deployed"
  | "archived";

export type ProjectRole = "owner" | "editor" | "viewer";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          /** The persisted lens. Never a lock-in: the toggle rewrites it. */
          view_mode: string;
          /** Whether "Do you write code?" has been answered. */
          onboarding_completed: boolean;
          display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          view_mode?: string;
          onboarding_completed?: boolean;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          view_mode?: string;
          onboarding_completed?: boolean;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          description: string | null;
          prompt: string | null;
          origin: ProjectOrigin;
          repo_full_name: string | null;
          /** The branch of `repo_full_name` the agents work in. Set by import. */
          repo_branch: string | null;
          framework: string | null;
          /** 'private' | 'shared'. Shared projects get a read-only link. */
          visibility: "private" | "shared";
          /** Opaque token for the read-only share link. Null means not shared. */
          share_token: string | null;
          status: ProjectStatus;
          accent: string;
          last_opened_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          description?: string | null;
          prompt?: string | null;
          origin?: ProjectOrigin;
          repo_full_name?: string | null;
          repo_branch?: string | null;
          framework?: string | null;
          visibility?: "private" | "shared";
          share_token?: string | null;
          status?: ProjectStatus;
          accent?: string;
          last_opened_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          description?: string | null;
          prompt?: string | null;
          origin?: ProjectOrigin;
          repo_full_name?: string | null;
          repo_branch?: string | null;
          framework?: string | null;
          visibility?: "private" | "shared";
          share_token?: string | null;
          status?: ProjectStatus;
          accent?: string;
          last_opened_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_members: {
        Row: {
          project_id: string;
          user_id: string;
          role: ProjectRole;
          created_at: string;
        };
        Insert: {
          project_id: string;
          user_id: string;
          role?: ProjectRole;
          created_at?: string;
        };
        Update: {
          project_id?: string;
          user_id?: string;
          role?: ProjectRole;
          created_at?: string;
        };
        Relationships: [];
      };
      project_env_vars: {
        Row: {
          id: string;
          project_id: string;
          key: string;
          value: string;
          target: "development" | "preview" | "production" | "all";
          is_secret: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          key: string;
          value: string;
          target?: "development" | "preview" | "production" | "all";
          is_secret?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          key?: string;
          value?: string;
          target?: "development" | "preview" | "production" | "all";
          is_secret?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * The agent's workspace. Every file the model writes lands here via the
       * write_file tool, and the file tree, code view and live preview all read
       * from this table. See supabase/migrations/0002_project_files.sql.
       */
      project_files: {
        Row: {
          id: string;
          project_id: string;
          path: string;
          content: string;
          language: string;
          prev_lines: number;
          version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          path: string;
          content?: string;
          language?: string;
          prev_lines?: number;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          path?: string;
          content?: string;
          language?: string;
          prev_lines?: number;
          version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * Per-project pipeline config. One row per project, created by a trigger.
       * `agent_models` is a real override map — the pipeline reads it before
       * every agent call, so a model chosen in the inspector is the model that
       * actually runs. See supabase/migrations/0004_pipeline.sql.
       */
      project_settings: {
        Row: {
          project_id: string;
          agent_models: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          project_id: string;
          agent_models?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          project_id?: string;
          agent_models?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * The persisted chat thread (Section 4). One row carries both audiences:
       * `body` is the plain-language phrasing Simple mode renders, `technical` is
       * what the per-message inline switch reveals in Developer mode.
       */
      project_messages: {
        Row: {
          id: string;
          project_id: string;
          role: "you" | "agent" | "system" | "gate";
          agent_key: string | null;
          body: string;
          technical: string | null;
          meta: Json;
          gate_status: "pending" | "approved" | "rejected" | "modified" | null;
          is_redirect: boolean;
          run_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          role: "you" | "agent" | "system" | "gate";
          agent_key?: string | null;
          body?: string;
          technical?: string | null;
          meta?: Json;
          gate_status?: "pending" | "approved" | "rejected" | "modified" | null;
          is_redirect?: boolean;
          run_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          role?: "you" | "agent" | "system" | "gate";
          agent_key?: string | null;
          body?: string;
          technical?: string | null;
          meta?: Json;
          gate_status?: "pending" | "approved" | "rejected" | "modified" | null;
          is_redirect?: boolean;
          run_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * One row per seven-agent pipeline execution (Sections 5, 9). `agents`
       * holds all seven artifacts as JSONB — they are always read and written
       * together and never queried across projects, so seven tables would have
       * meant seven identical RLS blocks for no benefit.
       */
      agent_runs: {
        Row: {
          id: string;
          project_id: string;
          prompt: string;
          state: "queued" | "running" | "done" | "needs-you" | "failed";
          agents: Json;
          gate: Json | null;
          receipt: string | null;
          sequence: string[];
          error: string | null;
          tokens: number;
          spent_at: Json;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          prompt: string;
          state?: "queued" | "running" | "done" | "needs-you" | "failed";
          agents?: Json;
          gate?: Json | null;
          receipt?: string | null;
          sequence?: string[];
          error?: string | null;
          tokens?: number;
          spent_at?: Json;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          prompt?: string;
          state?: "queued" | "running" | "done" | "needs-you" | "failed";
          agents?: Json;
          gate?: Json | null;
          receipt?: string | null;
          sequence?: string[];
          error?: string | null;
          tokens?: number;
          spent_at?: Json;
          started_at?: string;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * Immutable file snapshots (Section 9). `snapshot` holds every file's path
       * and content at that moment, which is what makes a restore an actual
       * revert of code, data bindings and UI rather than a scroll-back of the
       * chat transcript.
       */
      checkpoints: {
        Row: {
          id: string;
          project_id: string;
          run_id: string | null;
          label: string;
          commit_sha: string | null;
          model_summary: Json;
          snapshot: Json;
          stats: Json;
          source: string;
          is_head: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          run_id?: string | null;
          label: string;
          commit_sha?: string | null;
          model_summary?: Json;
          snapshot?: Json;
          stats?: Json;
          source?: string;
          is_head?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          run_id?: string | null;
          label?: string;
          commit_sha?: string | null;
          model_summary?: Json;
          snapshot?: Json;
          stats?: Json;
          source?: string;
          is_head?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      /** Deploy history (Section 8), each row tied to the checkpoint it shipped. */
      deployments: {
        Row: {
          id: string;
          project_id: string;
          checkpoint_id: string | null;
          environment: "preview" | "production";
          state: "queued" | "working" | "done" | "needs-you" | "failed";
          external_id: string | null;
          url: string | null;
          logs: string[];
          error: string | null;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          checkpoint_id?: string | null;
          environment?: "preview" | "production";
          state?: "queued" | "working" | "done" | "needs-you" | "failed";
          external_id?: string | null;
          url?: string | null;
          logs?: string[];
          error?: string | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          checkpoint_id?: string | null;
          environment?: "preview" | "production";
          state?: "queued" | "working" | "done" | "needs-you" | "failed";
          external_id?: string | null;
          url?: string | null;
          logs?: string[];
          error?: string | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * GitHub OAuth tokens (Section 7). Deliberately has NO select policy: RLS
       * protects rows, not columns, so a policy admitting the row would admit the
       * token with it. Every read goes through the service-role client in
       * lib/github/store.ts, which returns only `login` and `scopes`.
       */
      github_connections: {
        Row: {
          user_id: string;
          login: string;
          avatar_url: string | null;
          access_token: string;
          scopes: string[];
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          login: string;
          avatar_url?: string | null;
          access_token: string;
          scopes?: string[];
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          login?: string;
          avatar_url?: string | null;
          access_token?: string;
          scopes?: string[];
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /** The in-app notification centre (Section 10). Keyed on the person. */
      notifications: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          title: string;
          body: string | null;
          href: string | null;
          project_id: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: string;
          title: string;
          body?: string | null;
          href?: string | null;
          project_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          title?: string;
          body?: string | null;
          href?: string | null;
          project_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      /** Bumps updated_at on update. Defined in 0002_project_files.sql. */
      set_updated_at: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      /** RLS helper: is the current user a member of this project? */
      is_project_member: {
        Args: { p_project_id: string };
        Returns: boolean;
      };
      /** RLS helper: owner or editor (i.e. may mutate the project)? */
      can_edit_project: {
        Args: { p_project_id: string };
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/* ---- Convenience aliases used across the app ---- */

type Tables = Database["public"]["Tables"];

export type Profile = Tables["profiles"]["Row"];
export type Project = Tables["projects"]["Row"];
export type ProjectInsert = Tables["projects"]["Insert"];
export type ProjectUpdate = Tables["projects"]["Update"];
export type ProjectMember = Tables["project_members"]["Row"];
export type ProjectEnvVar = Tables["project_env_vars"]["Row"];
export type ProjectFile = Tables["project_files"]["Row"];
export type ProjectSettings = Tables["project_settings"]["Row"];
export type ProjectMessage = Tables["project_messages"]["Row"];
export type ProjectMessageInsert = Tables["project_messages"]["Insert"];
export type AgentRun = Tables["agent_runs"]["Row"];
export type Checkpoint = Tables["checkpoints"]["Row"];
export type Deployment = Tables["deployments"]["Row"];
export type Notification = Tables["notifications"]["Row"];
