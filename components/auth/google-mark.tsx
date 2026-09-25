/**
 * The Google mark.
 *
 * lucide-react v1 removed brand glyphs, so the four-colour G is inlined. It is
 * the only place in the product that uses Google's brand colours — every other
 * surface obeys the single-accent rule.
 */
export function GoogleMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={className}
      {...props}
    >
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.15-4.05 1.15-3.12 0-5.76-2.1-6.71-4.93H1.29v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.31a7.2 7.2 0 0 1 0-4.62v-3.1H1.29a12 12 0 0 0 0 10.82l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.59l4 3.1C6.24 6.85 8.88 4.75 12 4.75Z"
      />
    </svg>
  );
}

