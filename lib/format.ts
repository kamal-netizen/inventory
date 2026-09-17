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

/** "Whey Protein · Chocolate" */
export function productLabel(name: string, flavor: string): string {
  return flavor ? `${name} · ${flavor}` : name;
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
