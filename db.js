const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "tomalia.sqlite");
const SCHEMA_PATH = path.join(__dirname, "sql", "schema.sql");

function openDb() {
  const db = new sqlite3.Database(DB_PATH);
  return db;
}

function runSchema(db) {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
}

module.exports = { openDb, runSchema, DB_PATH };
