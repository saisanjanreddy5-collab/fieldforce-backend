import { pool } from "../config/db";

interface ManagerChangeLogRow {
  id: string;
  user_id: string;
  old_manager_id: string | null;
  new_manager_id: string | null;
  changed_by: string | null;
  changed_at: string;
}

function toPublicEntry(row: ManagerChangeLogRow) {
  return {
    id: row.id,
    userId: row.user_id,
    oldManagerId: row.old_manager_id,
    newManagerId: row.new_manager_id,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  };
}

// Read-only history, written only by user-service.ts's updateUser whenever a
// real manager_id change is saved. Newest first, optionally scoped to one
// person's own history (the "Transfers & history" list per employee).
export async function listManagerChanges(userId?: string) {
  const result = userId
    ? await pool.query<ManagerChangeLogRow>(
        "SELECT * FROM manager_change_log WHERE user_id = $1 ORDER BY changed_at DESC",
        [userId]
      )
    : await pool.query<ManagerChangeLogRow>("SELECT * FROM manager_change_log ORDER BY changed_at DESC LIMIT 200");
  return result.rows.map(toPublicEntry);
}
