import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { isSupabaseConfigured } from "@/lib/env";
import { getClaims } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

/**
 * Sign-in — REAL (Supabase Auth, both providers).
 *
 * The route guard lives here rather than in `proxy.ts` on purpose: the proxy
 * only refreshes the session cookie, and deciding "is this person allowed in"
 * is a render-time concern that belongs with the data it protects.
 */
export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  if (isSupabaseConfigured) {
    const claims = await getClaims();
    if (claims) redirect("/dashboard");
  }

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <AuthForm
      mode="sign-in"
      next={next}
      title="Welcome back"
      subtitle="Pick up where you left off — your projects are waiting."
      footerHref="/sign-up"
      footerPrompt="New here?"
      footerLabel="Create an account"
    />
  );
}
