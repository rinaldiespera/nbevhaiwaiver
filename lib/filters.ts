export interface DateFilters {
  date?: string; // YYYY-MM-DD (UTC)
  from?: string; // YYYY-MM-DD (UTC) inclusive
  to?: string; // YYYY-MM-DD (UTC) inclusive
}

export interface ParsedDateRange {
  /** Inclusive start (UTC date-only -> beginning of day) */
  start: Date | null;
  /** Exclusive end (start of day after last day) */
  endExclusive: Date | null;
  /** True if user gave a date= param, meaning we know it's a single-day filter */
  singleDay: boolean;
}

const RE_YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (!RE_YYYY_MM_DD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

export function parseDateFilters(
  q: Record<string, unknown>
): ParsedDateRange | { error: string } {
  const date = typeof q.date === "string" ? q.date : undefined;
  const from = typeof q.from === "string" ? q.from : undefined;
  const to = typeof q.to === "string" ? q.to : undefined;

  if (date && (from || to)) {
    return { error: "Cannot combine date with from/to range params" };
  }

  if (date) {
    if (!isValidDateString(date)) return { error: "Invalid date format" };
    const start = new Date(`${date}T00:00:00Z`);
    const endExclusive = new Date(start);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    return { start, endExclusive, singleDay: true };
  }

  if (from || to) {
    if (from && !isValidDateString(from)) return { error: "Invalid from date" };
    if (to && !isValidDateString(to)) return { error: "Invalid to date" };
    const start = from ? new Date(`${from}T00:00:00Z`) : null;
    const endExclusive = to
      ? (() => {
          const d = new Date(`${to}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1);
          return d;
        })()
      : null;
    return { start, endExclusive, singleDay: false };
  }

  return { start: null, endExclusive: null, singleDay: false };
}

export function downloadFiltersFromBody(
  body: unknown
): ParsedDateRange | { error: string } {
  if (!body || typeof body !== "object") {
    return { start: null, endExclusive: null, singleDay: false };
  }
  const b = body as Record<string, unknown>;
  return parseDateFilters({
    date: typeof b.date === "string" ? b.date : undefined,
    from: typeof b.from === "string" ? b.from : undefined,
    to: typeof b.to === "string" ? b.to : undefined,
  });
}
