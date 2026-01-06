const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const PROJECT_DB = path.join(__dirname, "tomalia.sqlite"); // shipped in repo
const ENV_DB = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : null;

const SCHEMA_PATH = path.join(__dirname, "sql", "schema.sql");

function pickDbPath() {
  // If user set DB_PATH (ex: /var/data/tomalia.sqlite), only use it when the directory exists
  if (ENV_DB) {
    const dir = path.dirname(ENV_DB);

    // IMPORTANT: do NOT try to mkdir /var/data (Render will deny it)
    if (dir === "/var/data" && !fs.existsSync(dir)) {
      console.warn(`[DB] ${dir} not found. Persistent Disk probably not mounted. Using local DB instead.`);
      return PROJECT_DB;
    }

    // If directory exists but DB file doesn't, seed it from repo DB
    if (fs.existsSync(dir) && !fs.existsSync(ENV_DB)) {
      try {
        fs.copyFileSync(PROJECT_DB, ENV_DB);
        console.log(`[DB] Seeded database: ${ENV_DB}`);
      } catch (e) {
        console.warn(`[DB] Could not seed DB to ${ENV_DB}. Using local DB instead.`, e);
        return PROJECT_DB;
      }
    }

    // If directory exists, use ENV_DB
    if (fs.existsSync(dir)) return ENV_DB;
  }

  return PROJECT_DB;
}

const DB_PATH = pickDbPath();

function openDb() {
  const db = new sqlite3.Database(DB_PATH);
  return db;
}

function runSchema(db) {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
}

module.exports = { openDb, runSchema, DB_PATH };
