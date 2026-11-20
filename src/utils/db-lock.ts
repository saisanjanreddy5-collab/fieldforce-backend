import { pool } from "../config/db";

// Runs fn while holding a Postgres advisory lock on `key`, so concurrent
// calls for the same key (e.g. one person submitting two leave requests at
// the same moment) take turns instead of both passing a check-then-insert.
// Keep these narrow (one person, one record) - a waiting caller holds a
// pooled connection.
export async function withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => undefined);
    client.release();
  }
}
