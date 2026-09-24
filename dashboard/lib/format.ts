export const nf = new Intl.NumberFormat("en-US");

export function compact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function ms(n: number): string {
  if (!n) return "–";
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(n > 0 && n < 0.01 ? 2 : 1)}%`;
}

/** Backend timestamps are naive UTC. */
export function utc(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function shortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
