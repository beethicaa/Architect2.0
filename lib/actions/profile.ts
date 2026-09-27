/**
 * Account preferences — the REAL slice (Section 2 of the brief).
 *
 * Three things live on `profiles` rather than in a cookie:
 *   - `view_mode` — the Simple/Developer lens, so it follows the *person*
 *   - `onboarding_completed` — whether "Do you write code?" has been answered
 *   - `display_name` — what the account menu shows
 *
 * The lens still writes a cookie and localStorage for instant feedback and for
 * the unauthenticated/mocked flows; this file is what makes it durable.
 *
 * NOTE: this is a "use server" module, so it may only export async functions
 * and types. A value export (a string constant, say) invalidates the module and
 * every call in it fails at runtime with an unhelpful "Connection closed".
 * `npm run env:check` scans for exactly that mistake.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { rethrowNavigation } from "@/lib/actions/navigation";
import { SUPABASE_HINT } from "@/lib/auth-error";
import {
  getServiceRoleKey,
  isSupabaseConfigured,
  supabaseEnv,
} from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export interface ProfileActionState {
  error: string | null;
  notice: string | null;
}

/**
 * The columns a user may change on their own row.
 *
 * Typed as the generated `Update` shape rather than `Record<string, ...>`, so a
 * typo or an unlisted column is a compile error instead of a Postgres 42701 at
 * runtime. `id` is excluded deliberately: the row is addressed by the session
 * claim, never by anything the client sends.
 */
type EditableProfile = Omit<Database["public"]["Tables"]["profiles"]["Update"], "id">;

/** Only these two words can ever be written to `view_mode`. */
function asViewMode(value: FormDataEntryValue | null) {
  return value === "developer" ? "developer" : "simple";
}

/**
 * Account deletion needs one key most demos will not have.
 *
 * Deleting an `auth.users` row is an *admin* operation: the publishable key
 * cannot do it, and pretending otherwise would leave a half-deleted account the
 * user can still sign back into. So this fails loudly with the exact fix
 * instead of reporting a success that did not happen.
 */
const DELETE_ACCOUNT_HINT =
  "Deleting an account also deletes its login identity, which needs SUPABASE_SERVICE_ROLE_KEY in .env.local. " +
  "Add it, restart the dev server, and try again. Nothing has been changed yet.";

const NO_SESSION = "Please sign in again to change your account settings.";

async function updateOwnProfile(
  patch: EditableProfile,
): Promise<ProfileActionState> {
  if (!isSupabaseConfigured) return { error: SUPABASE_HINT, notice: null };

  try {
    const supabase = await createClient();
    const claims = await getClaims();
    if (!claims) return { error: NO_SESSION, notice: null };

    const { error } = await supabase.from("profiles").update(patch).eq("id", claims.sub);

    if (error) {
      // The missing-column case is by far the most likely and has one specific
      // fix: run migration 0003. Saying that beats showing Postgres' text.
      if (error.code === "42703" || /column .* does not exist/i.test(error.message)) {
        return {
          error:
            "Your account is missing its newer settings. Run supabase/migrations/0003_profile_preferences.sql in the Supabase SQL editor.",
          notice: null,
        };
      }
      return { error: "We could not save that change. " + error.message, notice: null };
    }

    revalidatePath("/", "layout");
    return { error: null, notice: null };
  } catch (caught) {
    console.error("[architect] updateOwnProfile failed:", caught);
    return {
      error: "We could not reach your account. Check your connection and try again.",
      notice: null,
    };
  }
}

/**
 * Persist the Simple/Developer lens.
 *
 * The client already flipped the toggle locally for instant feedback; this only
 * writes it to the account so it survives a new device. Called fire-and-forget
 * from the provider, so it returns a state rather than redirecting.
 */
export async function saveLens(formData: FormData): Promise<ProfileActionState> {
  return updateOwnProfile({ view_mode: asViewMode(formData.get("view_mode")) });
}

/** Record the one-question onboarding answer. Soft default, changeable forever. */
export async function completeOnboarding(
  formData: FormData,
): Promise<ProfileActionState> {
  const viewMode = asViewMode(formData.get("view_mode"));
  const result = await updateOwnProfile({
    view_mode: viewMode,
    onboarding_completed: true,
  });

  // Land them on the surface their answer implies, so the product explains
  // itself by where it takes them rather than by a tour.
  if (!result.error) redirect("/dashboard");
  return result;
}

/** The name shown in the account menu. */
export async function saveDisplayName(
  formData: FormData,
): Promise<ProfileActionState> {
  const raw = String(formData.get("display_name") ?? "").trim();
  if (raw.length > 60) {
    return { error: "That name is too long. Keep it under 60 characters.", notice: null };
  }
  return updateOwnProfile({ display_name: raw || null });
}


/**
 * Delete the signed-in account, for real.
 *
 * "Delete account" that only removes the profile row would be the worst kind of
 * fake: the user still signs in successfully afterwards and concludes the
 * product lied. Deleting the `auth.users` row is an admin operation, so this
 * uses the service-role key against the Auth admin endpoint and only reports
 * success once the login is genuinely gone.
 */
export async function deleteAccount(): Promise<ProfileActionState> {
  if (!isSupabaseConfigured) return { error: SUPABASE_HINT, notice: null };

  const serviceRole = getServiceRoleKey();
  if (!serviceRole) {
    return {
      error:
        "To finish deleting your account we need one extra key. " + DELETE_ACCOUNT_HINT,
      notice: null,
    };
  }

  try {
    const claims = await getClaims();
    if (!claims) return { error: NO_SESSION, notice: null };

    const response = await fetch(`${supabaseEnv.url}/auth/v1/admin/users/${claims.sub}`, {
      method: "DELETE",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("[architect] deleteAccount failed:", response.status, body);
      return {
        error: "We could not delete your account. Your projects are untouched. Try again.",
        notice: null,
      };
    }

    // The identity is gone, so the session cookie is now meaningless. Sign out
    // locally too, or the user sits on an authenticated shell for a dead user.
    const supabase = await createClient();
    await supabase.auth.signOut();

    redirect("/");
  } catch (caught) {
    // redirect() throws by design; only a real failure should reach here.
    rethrowNavigation(caught);
    console.error("[architect] deleteAccount failed:", caught);
    return {
      error: "We could not reach your account. Check your connection and try again.",
      notice: null,
    };
  }
}

