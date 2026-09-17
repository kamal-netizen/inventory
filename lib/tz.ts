/**
 * Display timezone. This one lives apart from lib/config.ts because dates are
 * formatted in the browser too, and config.ts is server-only.
 */
export const TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Dubai";
