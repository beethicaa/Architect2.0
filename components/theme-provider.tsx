"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Class-based dark mode with no flash of the wrong theme.
 *
 * Architect 2.0 ships light and dark from day one: the builder workspace is
 * dark-leaning for long sessions, and the landing page/marketing surfaces are
 * light-leaning. Tokens for both live in app/globals.css.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
