import { AuthForm } from "@/components/auth/auth-form";
import { isSupabaseConfigured } from "@/lib/env";
import { getClaims } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Create an account" };

export default async function SignUpPage() {
  if (isSupabaseConfigured) {
    const claims = await getClaims();
    if (claims) redirect("/dashboard");
  }

  return (
    <AuthForm
      mode="sign-up"
      title="Start building"
      subtitle="Describe an app in a sentence, or bring a repository. Both start the same way."
      footerHref="/sign-in"
      footerPrompt="Already have an account?"
      footerLabel="Sign in"
    />
  );
}
