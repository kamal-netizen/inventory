// Clears login lockouts. Run when someone has locked themselves out:
//   npm run unlock
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// Minimal .env reader so this works without extra dependencies.
const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — nothing to connect to.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  const { rowCount } = await client.query("DELETE FROM login_attempts");
  console.log(
    rowCount === 0
      ? "Nothing was locked."
      : `Cleared ${rowCount} lockout record(s). Anyone can try their PIN again.`
  );
} finally {
  await client.end();
}
