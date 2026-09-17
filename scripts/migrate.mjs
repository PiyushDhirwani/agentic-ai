/**
 * Applies db/schema.sql to the Neon database in DATABASE_URL.
 *   npm run db:migrate            (reads .env.local)
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local or export it.");
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

/** Drops comment lines so a leading `--` does not swallow the statement. */
function stripComments(chunk) {
  return chunk
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

// neon()'s tagged template is single-statement, so split on statement boundaries.
const statements = schema
  .split(/;\s*$/m)
  .map(stripComments)
  .filter((statement) => statement.length > 0);

for (const statement of statements) {
  const label = statement.replace(/\s+/g, " ").slice(0, 70);
  process.stdout.write(`-> ${label} ... `);
  await sql.query(statement);
  console.log("ok");
}

console.log(`\nApplied ${statements.length} statements.`);
