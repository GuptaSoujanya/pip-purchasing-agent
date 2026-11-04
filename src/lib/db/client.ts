import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Single shared SQLite handle.
 *
 * Next dev-mode hot reloads re-evaluate modules, so the handle is cached on
 * globalThis to avoid opening (and leaking) a new connection on every reload.
 */

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(process.cwd(), "data", "purchasing.db");

const SCHEMA_PATH = path.join(process.cwd(), "src", "lib", "db", "schema.sql");

type Global = typeof globalThis & { __purchasingDb?: Database.Database };
const g = globalThis as Global;

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function getDb(): Database.Database {
  if (!g.__purchasingDb || !g.__purchasingDb.open) {
    g.__purchasingDb = open();
  }
  return g.__purchasingDb;
}

/** Drop and rebuild the database from schema.sql. Used by `npm run db:reset`. */
export function resetSchema(): Database.Database {
  if (g.__purchasingDb?.open) {
    g.__purchasingDb.close();
    g.__purchasingDb = undefined;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  const db = open();
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  g.__purchasingDb = db;
  return db;
}

export { DB_PATH };
