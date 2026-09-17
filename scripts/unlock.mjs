// Clears login lockouts. Run when someone has locked themselves out:
//   npm run unlock
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Minimal .env reader so this works without extra dependencies.
const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const file = path.resolve(process.env.DATABASE_PATH || "./data/inventory.db");
if (!fs.existsSync(file)) {
  console.log(`No database at ${file} — nothing to unlock.`);
  process.exit(0);
}

const db = new Database(file);
const { changes } = db.prepare("DELETE FROM login_attempts").run();
console.log(changes === 0 ? "Nothing was locked." : `Cleared ${changes} lockout record(s). Anyone can try their PIN again.`);
