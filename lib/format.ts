import { TIMEZONE } from "./tz";

const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "short",
});

const fullDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "2:14 PM" */
export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

/** The date key used to group history into day sections. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(iso));
}

/** "Today", "Yesterday", or "12 Sep" */
export function formatDay(iso: string): string {
  const key = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());

  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return dayMonth.format(new Date(iso));
}

/** "Monday, 15 September" — the heading under a day group. */
export function formatFullDate(iso: string): string {
  return fullDate.format(new Date(iso));
}

const expiryDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "12 Mar 2027", from a stored YYYY-MM-DD. UTC both ways, so the day never shifts. */
export function formatExpiry(expiry: string): string {
  return expiryDate.format(new Date(`${expiry}T00:00:00Z`));
}

/** "Whey Protein · Chocolate" */
export function productLabel(name: string, flavor: string): string {
  return flavor ? `${name} · ${flavor}` : name;
}

/**
 * Whether a search matches a product.
 *
 * Every word typed has to turn up somewhere in the brand, name, flavour or batch,
 * in any order. Matching the whole phrase as one string meant "core champs whey
 * rich chocolate" found nothing against "CORE CHAMPS WHEY PROTEIN 5LBS/2.27KG -
 * RICH CHOCOLATE", because the words are not next to each other.
 */
export function matchesSearch(
  product: { brand: string; name: string; flavor: string; batch_no?: string },
  search: string
): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${product.brand} ${product.name} ${product.flavor} ${product.batch_no ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** "17-09-2026" — day first, the way it is read here. */
export function fileDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(iso));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

/**
 * Strips what Windows, macOS or a browser would choke on in a filename.
 * Spaces and hyphens stay — they carry the [warehouse] [SO no] [date] shape.
 */
export function safeFilename(value: string): string {
  const illegal = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]+', "g");
  return value.replace(illegal, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** `dateStr` (YYYY-MM-DD) shifted by `days` on the calendar — no timezone involved. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const PERIODS = ["daily", "weekly", "monthly"] as const;
export type ReportPeriod = (typeof PERIODS)[number];

export function isReportPeriod(value: string | null): value is ReportPeriod {
  return PERIODS.some((period) => period === value);
}

/** The first and last day of the day, Monday-to-Sunday week or month `dateStr` falls in. */
export function reportRange(period: ReportPeriod, dateStr: string): { from: string; to: string } {
  if (period === "daily") return { from: dateStr, to: dateStr };
  if (period === "weekly") {
    const sinceMonday = (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
    const from = addDays(dateStr, -sinceMonday);
    return { from, to: addDays(from, 6) };
  }
  const [year, month] = dateStr.split("-").map(Number);
  return {
    from: `${dateStr.slice(0, 7)}-01`,
    // Day 0 of next month is the last day of this one.
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

const REASON_LABEL: Record<string, string> = {
  new: "Added to list",
  in: "Stock in",
  out: "Stock out",
  adjust: "Adjusted",
  invoice: "Delivery note",
  credit: "Credit note",
  damage: "Damaged",
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? "Changed";
}

/** Minutes a UTC instant sits ahead of TIMEZONE's wall clock, e.g. 240 for Dubai. */
function tzOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});

  const readAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (readAsUtc - instant.getTime()) / 60000;
}

/**
 * The UTC instant of local midnight at the start of `dateStr` (YYYY-MM-DD) in
 * TIMEZONE, as an ISO string — so a date picked in Dubai turns into the right
 * `created_at` boundary rather than UTC midnight on the same digits.
 */
export function startOfLocalDayUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60000).toISOString();
}
