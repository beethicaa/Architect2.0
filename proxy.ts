import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 file convention: `proxy.ts` (the former `middleware.ts`).
 *
 * Its only job in Architect 2.0 is refreshing the Supabase auth session cookie.
 * See docs/real-vs-dummy.md for what is real vs. mocked in this product.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and images so page requests always
     * carry an up-to-date session.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
