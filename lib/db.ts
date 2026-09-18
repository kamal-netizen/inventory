import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * One Postgres database holds everything. Both warehouses live in it, but every
 * row carries a `warehouse` key and every query in lib/queries.ts filters on it,
 * so neither side can ever read the other's data.
 *
 * This was SQLite in a file until the app moved onto a deployment platform that
 * rebuilds the container on every deploy — which threw the file away each time,
 * along with everything in it.
 */

const MIGRATIONS: string[] = [
  // v1 — the schema, as SQLite left it.
  `
  CREATE TABLE products (
    id           SERIAL PRIMARY KEY,
    warehouse    TEXT    NOT NULL,
    brand        TEXT    NOT NULL DEFAULT '',
    name         TEXT    NOT NULL,
    flavor       TEXT    NOT NULL DEFAULT '',
    quantity     INTEGER NOT NULL DEFAULT 0,
    low_stock_at INTEGER NOT NULL DEFAULT 0,
    hidden       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL
  );
  CREATE UNIQUE INDEX products_unique
    ON products(warehouse, lower(brand), lower(name), lower(flavor));
  CREATE INDEX products_warehouse ON products(warehouse, hidden);

  CREATE TABLE invoices (
    id           SERIAL PRIMARY KEY,
    warehouse    TEXT    NOT NULL,
    ref          TEXT    NOT NULL,
    customer     TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'active',
    created_at   TEXT    NOT NULL,
    cancelled_at TEXT
  );
  CREATE INDEX invoices_warehouse ON invoices(warehouse, created_at);

  CREATE TABLE movements (
    id         SERIAL PRIMARY KEY,
    warehouse  TEXT    NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change     INTEGER NOT NULL,
    reason     TEXT    NOT NULL,
    ref        TEXT    NOT NULL DEFAULT '',
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    undone     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );
  CREATE INDEX movements_warehouse ON movements(warehouse, created_at);
  CREATE INDEX movements_invoice ON movements(invoice_id);

  CREATE TABLE login_attempts (
    ip           TEXT PRIMARY KEY,
    fails        INTEGER NOT NULL DEFAULT 0,
    lockouts     INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
  );
  `,
];

/** Where the schema version lives. Postgres has no PRAGMA user_version. */
const VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_version (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  );
  INSERT INTO schema_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
`;

/**
 * Arbitrary but fixed: two app instances starting together must pick the same
 * number for the lock to mean anything.
 */
const MIGRATION_LOCK = 8_713_204;

let pool: Pool | null = null;
let migrated: Promise<void> | null = null;

function connect(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is missing. Locally it goes in .env; in production the " +
        "platform injects it once the project's database allows direct access."
    );
  }

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Applies any migrations this file has that the database does not.
 *
 * A session-level advisory lock, taken before the version is read, is what makes
 * two instances starting at once safe: the second waits, re-reads the version,
 * finds nothing to do and returns. Without it both read version 0 and both try
 * to create the tables, and the loser dies with "relation already exists".
 */
async function migrate(client: PoolClient): Promise<void> {
  await client.query(VERSION_TABLE);
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);

  try {
    const { rows } = await client.query<{ version: number }>(
      "SELECT version FROM schema_version WHERE id = 1"
    );
    const version = rows[0]?.version ?? 0;

    for (let i = version; i < MIGRATIONS.length; i++) {
      await client.query("BEGIN");
      try {
        await client.query(MIGRATIONS[i]);
        await client.query("UPDATE schema_version SET version = $1 WHERE id = 1", [i + 1]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
  }
}

// Reuse one pool across hot reloads in dev, otherwise every edit leaks handles.
const cache = globalThis as unknown as {
  __inventoryPool?: Pool;
  __inventoryMigrated?: Promise<void>;
};

/**
 * The pool, created and migrated on first query rather than at import.
 *
 * `next build` evaluates every route module to collect page data; opening a
 * database there would connect during the build, in each of several parallel
 * workers, to something the built image has no business touching.
 */
export async function db(): Promise<Pool> {
  pool ??= cache.__inventoryPool ??= connect();
  const active = pool;

  // Migrate exactly once per process, and let every caller wait on that one run.
  migrated ??= cache.__inventoryMigrated ??= (async () => {
    const client = await active.connect();
    try {
      await migrate(client);
    } finally {
      client.release();
    }
  })();

  try {
    await migrated;
  } catch (error) {
    // Do not keep a rejected promise: a database that was briefly unreachable
    // would otherwise leave this process permanently broken, rethrowing the
    // first failure forever even once the database came back.
    migrated = null;
    cache.__inventoryMigrated = undefined;
    throw error;
  }

  return active;
}

/** Run a statement and get the rows back. */
export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await (await db()).query<T>(text, values);
  return result.rows;
}

/** Run a statement and get the first row, or null. */
export async function one<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/**
 * Runs `fn` inside a transaction on a single connection.
 *
 * Every statement in `fn` must go through the client it is handed — reaching for
 * `query()` instead takes a different connection from the pool and lands outside
 * the transaction, which is how a "one or nothing" invoice quietly becomes a
 * partial one.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function now(): string {
  return new Date().toISOString();
}
