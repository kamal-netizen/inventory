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

function migrate(db: Database.Database) {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

function connect(): Database.Database {
  // The path is deliberately configurable (the VPS may keep the database on its
  // own volume). The ignore comment stops the bundler tracing the whole project
  // into the deploy output just because this resolve is dynamic.
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || "./data/inventory.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

// Reuse one connection across hot reloads in dev, otherwise every edit leaks a handle.
const cache = globalThis as unknown as { __inventoryDb?: Database.Database };
export const db: Database.Database = cache.__inventoryDb ?? (cache.__inventoryDb = connect());

export function now(): string {
  return new Date().toISOString();
}
