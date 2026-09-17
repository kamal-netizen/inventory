import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * One SQLite file holds everything. Both warehouses live in it, but every row
 * carries a `warehouse` key and every query in lib/queries.ts filters on it,
 * so neither side can ever read the other's data.
 */

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse    TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    flavor       TEXT    NOT NULL DEFAULT '',
    quantity     INTEGER NOT NULL DEFAULT 0,
    low_stock_at INTEGER NOT NULL DEFAULT 0,
    hidden       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL
  );
  CREATE UNIQUE INDEX products_unique ON products(warehouse, lower(name), lower(flavor));
  CREATE INDEX products_warehouse ON products(warehouse, hidden);

  CREATE TABLE invoices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse    TEXT    NOT NULL,
    ref          TEXT    NOT NULL,
    customer     TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'active',
    created_at   TEXT    NOT NULL,
    cancelled_at TEXT
  );
  CREATE INDEX invoices_warehouse ON invoices(warehouse, created_at);

  CREATE TABLE movements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
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

  // v2 — brand. Real catalogues group products under a manufacturer, and with
  // several hundred items that grouping is what makes the list navigable.
  `
  ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT '';
  DROP INDEX products_unique;
  CREATE UNIQUE INDEX products_unique
    ON products(warehouse, lower(brand), lower(name), lower(flavor));
  `,
];

/**
 * Applies any migrations this file has that the database does not.
 *
 * BEGIN IMMEDIATE, not BEGIN, and the version is read INSIDE the transaction.
 * A deferred BEGIN takes no write lock until the first write, so two processes
 * starting together both read user_version = 0, both run migration 1, and the
 * second dies with "table products already exists". That is not hypothetical:
 * `next build` collects page data with several workers at once, and a server
 * can start more than one worker process against the same file.
 *
 * Taking the write lock up front serialises them. The loser waits (busy_timeout
 * is already set), re-reads the version, finds nothing to do, and commits.
 */
function migrate(connection: Database.Database) {
  connection.exec("BEGIN IMMEDIATE");
  try {
    const version = connection.pragma("user_version", { simple: true }) as number;
    for (let i = version; i < MIGRATIONS.length; i++) {
      connection.exec(MIGRATIONS[i]);
      connection.pragma(`user_version = ${i + 1}`);
    }
    connection.exec("COMMIT");
  } catch (err) {
    connection.exec("ROLLBACK");
    throw err;
  }
}

function connect(): Database.Database {
  // The path is deliberately configurable (the VPS may keep the database on its
  // own volume). The ignore comment stops the bundler tracing the whole project
  // into the deploy output just because this resolve is dynamic.
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || "./data/inventory.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const connection = new Database(file);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");
  migrate(connection);
  return connection;
}

// Reuse one connection across hot reloads in dev, otherwise every edit leaks a handle.
const cache = globalThis as unknown as { __inventoryDb?: Database.Database };

/**
 * The connection, opened on first query rather than at import.
 *
 * A function, not a constant, because `next build` evaluates every route module
 * to collect page data — and a constant would open the file and run migrations
 * during the build, in each of several parallel workers, against a database the
 * built image has no business touching.
 */
export function db(): Database.Database {
  return (cache.__inventoryDb ??= connect());
}

export function now(): string {
  return new Date().toISOString();
}
