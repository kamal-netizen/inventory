/**
 * Startup check. Runs once, before the server accepts a single request.
 *
 * This exists because of a specific failure: a build with no DATABASE_URL was
 * deployed, passed its health check, and served 500s to everyone.
 *
 * The health check probes `/`. For a signed-out visitor that redirects to
 * /login before touching the database, so it answered 307 and the deploy was
 * declared healthy — while every page that actually reads anything was broken.
 * A platform cannot tell a working app from a broken one by asking a route that
 * does no work.
 *
 * This hook is NOT the thing that stops a broken build going live — that was
 * tried and it does not work. Next logs a failing `register` and carries on
 * binding the port and answering requests, so a throw here changes nothing a
 * health check can see. The gate is `await db()` at the top of the signed-in
 * layout, which makes `/` itself fail.
 *
 * What this is for: applying migrations and warming the pool at startup rather
 * than on somebody's first request, and putting one clear line in the container
 * log saying exactly what is wrong when something is.
 */
export async function register() {
  // The edge runtime has no database and no need for any of this.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { pinLength } = await import("./lib/config");
  const { query } = await import("./lib/db");

  try {
    // Parses WAREHOUSES and every PIN_/NAME_ pair, throwing if one is wrong.
    pinLength();
    await query("SELECT 1");
    console.log("[startup] configuration and database are both reachable");
  } catch (error) {
    // Logged, not rethrown: an unhandled rejection here buys nothing but noise.
    console.error(
      "[startup] this app cannot serve:",
      error instanceof Error ? error.message : String(error)
    );
  }
}
