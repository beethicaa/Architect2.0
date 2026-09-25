export { cn } from "cn";

/**
 * Small shared helpers.
 *
 * Deliberately hand-written rather than pulled from a date/format library: the
 * product needs four very specific formats, and a 40kB dependency to render
 * "3d ago" and "US$0.18" would be a poor trade in an assignment about
 * first-principles choices.
 */

/** Initials for an avatar fallback: "Beethica Rath" -> "BR". */
export function initials(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Relative time for project lists.
 *
 * Deliberately coarse ("3d ago") rather than a full duration library: the
 * dashboard only needs to answer "is this something I was working on?".
 */
export function relativeTime(
  input: string | Date | null | undefined,
): string {
  if (!input) return "-";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "-";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";

  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "minute"],
    [3600, "hour"],
    [86_400, "day"],
    [604_800, "week"],
    [2_629_800, "month"],
    [31_557_600, "year"],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let chosen: [number, Intl.RelativeTimeFormatUnit] = units[0];
  for (const unit of units) {
    if (seconds >= unit[0]) chosen = unit;
  }
  return formatter.format(
    -Math.round(seconds / chosen[0]),
    chosen[1],
  );
}

/** "1,240" - used for token counts and commit counts. */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

/** "US$0.18" - developer-lens cost readouts. */
export function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

/** A short, readable id: "9f3c...a21b". */
export function shortId(value: string, length = 4): string {
  return value.length <= length * 2
    ? value
    : `${value.slice(0, length)}...${value.slice(-length)}`;
}
