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
