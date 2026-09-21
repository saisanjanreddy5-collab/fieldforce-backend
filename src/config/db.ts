import { Pool, types } from "pg";
import { env } from "./env";

// node-postgres's default DATE (OID 1082) parser builds a JS Date at
// local-server-timezone midnight, which then serializes to JSON as a UTC
// ISO string - on any server whose local time is ahead of UTC, that shifts
// the calendar date back by a day (e.g. 2026-01-15 round-trips as
// "2026-01-14T18:30:00.000Z" on an IST server). Returning the raw
// "YYYY-MM-DD" string Postgres sends instead avoids the Date-object
// conversion entirely, so a DATE column always round-trips as the exact
// calendar date it was given. This only touches OID 1082 - TIMESTAMP
// (1114) and TIMESTAMPTZ (1184) keep their default parsing untouched.
types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
  process.exit(1);
});
