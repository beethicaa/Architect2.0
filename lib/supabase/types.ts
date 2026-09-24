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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
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
          framework: string | null;
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
          framework?: string | null;
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
          framework?: string | null;
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
    };
    Views: { [_ in never]: never };
    Functions: {
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
