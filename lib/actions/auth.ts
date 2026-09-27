/**
 * Auth Server Actions — the REAL slice.
 *
 * Both providers are handled here (Supabase Auth), and both return the same
 * `AuthState` so `auth-form.tsx` has exactly one error path to render. Errors
 * are *translated* in `lib/auth-error.ts` because "AuthApiError: Invalid login
 * credentials" is not something to show a person.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  authErrorMessage,
  AUTH_UNREACHABLE,
  SUPABASE_HINT,
} from "@/lib/auth-error";
import { rethrowNavigation } from "@/lib/actions/navigation";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error: string | null;
  /** Set when sign-up succeeded but the project requires email confirmation. */
  notice: string | null;
  /** Where to send the user after a successful sign-in. */
  redirectTo: string;
}

// NOTE: this is a "use server" file, so it may ONLY export async functions.
// A string constant exported from here makes the Server Action module invalid
// and every action call fails at runtime with a 500 and an unhelpful
// "Connection closed." message. User-facing copy therefore lives in
// `lib/auth-error.ts`; only the actions and the `AuthState` type live here.

const initialState: AuthState = { error: null, notice: null, redirectTo: "/dashboard" };

/** Email + password sign-in. */
export async function signInWithPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (!isSupabaseConfigured) {
    return { ...initialState, error: SUPABASE_HINT };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    return { ...initialState, error: "Enter your email and password." };
  }

  // Same reasoning as signUp: a transport failure must produce a sentence about
  // the connection, not a 500 and definitely not "wrong password".
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { ...initialState, error: authErrorMessage(error.message) };
    }

    revalidatePath("/", "layout");
    // `next` is user-controlled, so it is normalised: only same-origin paths, so
    // this can never be used as an open redirect.
    redirect(safeNext(next));
  } catch (thrown) {
    // `redirect()` throws rather than returns, so a bare catch here would treat
    // a *successful* sign-in as a network failure. That bug shipped once: the
    // user was told Supabase was unreachable when they had actually signed in.
    rethrowNavigation(thrown);
    console.error("[architect] signIn failed:", thrown);
    return { ...initialState, error: AUTH_UNREACHABLE };
  }
}

/** Email + password sign-up. */
export async function signUpWithPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (!isSupabaseConfigured) {
    return { ...initialState, error: SUPABASE_HINT };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!email || !password) {
    return { ...initialState, error: "Enter an email and a password." };
  }
  if (password.length < 8) {
    return {
      ...initialState,
      error: "Use at least 8 characters so the account is hard to guess.",
    };
  }
  if (password !== confirm) {
    return { ...initialState, error: "Those passwords do not match." };
  }

  // `signUp` normally *returns* a network error, but the cookie store runs
  // inside the request scope and a transport-level failure there can surface as
  // a throw. Either way the person must get a sentence, never a 500 - this is
  // the screen they are on when their connection is the problem.
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Read by the `handle_new_user` trigger to fill the profile row.
        data: { full_name: name || email.split("@")[0] },
        emailRedirectTo: `${getSiteUrl()}/auth/callback`,
      },
    });

    if (error) {
      return { ...initialState, error: authErrorMessage(error.message) };
    }

    // When email confirmation is on, Supabase returns a user with no session.
    if (data.session) {
      revalidatePath("/", "layout");
      redirect("/dashboard");
    }
  } catch (error) {
    // redirect() throws, so this must come first: otherwise a *successful*
    // sign-up would be reported as an unreachable Supabase.
    rethrowNavigation(error);
    console.error("[architect] signUp failed:", error);
    return { ...initialState, error: AUTH_UNREACHABLE };
  }

  return {
    ...initialState,
    notice:
      "Check your inbox to confirm the address, then sign in. You can close this tab.",
  };
}

/**
 * Google sign-in.
 *
 * Server-initiated on purpose: the OAuth handshake belongs to the server (which
 * owns the callback route and the cookie), not to the browser. The browser
 * receives a real redirect, and Supabase's PKCE verifier is set as a cookie by
 * `signInWithOAuth` so `/auth/callback` can complete the exchange.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!isSupabaseConfigured) return;

  const next = safeNext(String(formData.get("next") ?? "/dashboard"));

  try {
    const supabase = await createClient();

    const { data } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
        // `access_type=offline` and `prompt=consent` were both requested here and
        // removed. The server client is already PKCE, so the flow itself was
        // never the problem - but `prompt=consent` made Google re-prompt on every
        // sign-in, and forcing an offline token asks Google for a refresh token
        // that Supabase manages itself.
        //
        // (I briefly added `flowType: "pkce"` here on the theory that implicit
        // flow was returning tokens in the fragment. That was wrong: the server
        // client is PKCE-only and does not accept the option. TypeScript caught
        // it, which is the only reason it did not ship.)
        scopes: "email profile",
      },
    });

    if (data.url) redirect(data.url);
  } catch (error) {
    // Same trap as the password paths: `redirect()` throws, and swallowing it
    // would turn every Google sign-in into "we could not reach Supabase".
    rethrowNavigation(error);

    // The OAuth handshake needs a network call, so it can fail for the same
    // reasons as the password paths. Send them somewhere that explains it.
    console.error("[architect] signInWithGoogle failed:", error);
    redirect(`/auth/error?code=provider_unreachable`);
  }
}

/** Sign out, everywhere. */
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/");
}

/** Only same-origin, absolute paths — an open-redirect guard for `?next=`. */
function safeNext(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
