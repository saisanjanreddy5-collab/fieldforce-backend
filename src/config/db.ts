import { Pool, types } from "pg";
import { env } from "./env";
import { BUSINESS_TIMEZONE } from "../utils/business-time";

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
  // Keep connections open between requests. pg's defaults (close after 10 s
  // idle, keep none) made the first page load after any short pause re-open
  // every connection - measured at ~0.5 s per page load on the dev box.
  max: 20,
  min: 4,
  idleTimeoutMillis: 300_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  // India time for every query (see utils/business-time.ts) - CURRENT_DATE,
  // date_trunc("month", ...) and "YYYY-MM-DD"::date comparisons used UTC,
  // so reports, leave and transfers disagreed about what "today" was.
  options: `-c timezone=${BUSINESS_TIMEZONE}`,
  // Safety net: no single query may hold a connection forever. Nothing in
  // normal use comes close to this; it only cuts off a runaway query before
  // it can exhaust the pool and take the whole API down with it.
  statement_timeout: 60_000,
});

// An idle client dropping (DB restart, network blip) is already removed
// from the pool by pg itself - the next query just opens a fresh
// connection. Exiting here would turn a momentary blip into an outage.
pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
});
