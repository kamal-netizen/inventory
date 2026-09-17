import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db, now } from "./db";
import { trustedDeviceDays, warehouseByKey, warehouseByPin, type Warehouse } from "./config";

const COOKIE = "inv_session";

/* ------------------------------------------------------------------ *
 * Session cookie — signed so it cannot be forged, holds only the
 * warehouse key. The PIN itself is never stored in the cookie.
 * ------------------------------------------------------------------ */

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET is missing from .env (needs 32+ characters)");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function makeToken(warehouseKey: string): string {
  const payload = Buffer.from(JSON.stringify({ w: warehouseKey, t: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const { w } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof w === "string" ? w : null;
  } catch {
    return null;
  }
}

/** The warehouse this request belongs to, or null if not signed in. */
export async function getWarehouse(): Promise<Warehouse | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const key = readToken(token);
  // A key that no longer exists in .env invalidates the session.
  return key ? (warehouseByKey(key) ?? null) : null;
}

/** Same, but throws — for pages and actions that must be signed in. */
export async function requireWarehouse(): Promise<Warehouse> {
  const warehouse = await getWarehouse();
  if (!warehouse) throw new Error("Not signed in");
  return warehouse;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

async function startSession(warehouse: Warehouse) {
  (await cookies()).set(COOKIE, makeToken(warehouse.key), {
    ...COOKIE_OPTIONS,
    maxAge: trustedDeviceDays() * 24 * 60 * 60,
  });
}

export async function endSession() {
  // Overwrite with an already-expired cookie rather than delete(): the browser
  // only drops a cookie when the attributes match the ones it was set with.
  (await cookies()).set(COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0, expires: new Date(0) });
}

/* ------------------------------------------------------------------ *
 * Lockout — with no usernames, wrong PINs are counted against the
 * device/IP instead of an account, and the penalty escalates.
 * ------------------------------------------------------------------ */

const MAX_TRIES = 5;
const LOCK_MINUTES = [15, 60, 60 * 24]; // 1st lockout, 2nd, 3rd and beyond

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "local";
}

interface Attempt {
  fails: number;
  lockouts: number;
  locked_until: string | null;
}

function attemptRow(ip: string): Attempt {
  const row = db().prepare("SELECT fails, lockouts, locked_until FROM login_attempts WHERE ip = ?").get(ip) as
    | Attempt
    | undefined;
  return row ?? { fails: 0, lockouts: 0, locked_until: null };
}

/** Minutes remaining on a lock, or 0 if this IP may try. */
export async function lockedFor(): Promise<number> {
  const { locked_until } = attemptRow(await clientIp());
  if (!locked_until) return 0;

  const remaining = new Date(locked_until).getTime() - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 60000) : 0;
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "locked"; minutes: number }
  | { ok: false; reason: "wrong"; triesLeft: number }
  | { ok: false; reason: "wrong"; triesLeft: 0; minutes: number };

export async function attemptLogin(pin: string): Promise<LoginResult> {
  const ip = await clientIp();

  const locked = await lockedFor();
  if (locked > 0) return { ok: false, reason: "locked", minutes: locked };

  const warehouse = warehouseByPin(pin);
  if (warehouse) {
    db().prepare("DELETE FROM login_attempts WHERE ip = ?").run(ip);
    await startSession(warehouse);
    return { ok: true };
  }

  const current = attemptRow(ip);
  const fails = current.fails + 1;

  if (fails >= MAX_TRIES) {
    const lockouts = current.lockouts + 1;
    const minutes = LOCK_MINUTES[Math.min(lockouts, LOCK_MINUTES.length) - 1];
    const until = new Date(Date.now() + minutes * 60000).toISOString();

    db().prepare(
      `INSERT INTO login_attempts (ip, fails, lockouts, locked_until) VALUES (?, 0, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET fails = 0, lockouts = ?, locked_until = ?`
    ).run(ip, lockouts, until, lockouts, until);

    return { ok: false, reason: "wrong", triesLeft: 0, minutes };
  }

  db().prepare(
    `INSERT INTO login_attempts (ip, fails, lockouts, locked_until) VALUES (?, ?, 0, NULL)
     ON CONFLICT(ip) DO UPDATE SET fails = ?`
  ).run(ip, fails, fails);

  return { ok: false, reason: "wrong", triesLeft: MAX_TRIES - fails };
}

export { now };
