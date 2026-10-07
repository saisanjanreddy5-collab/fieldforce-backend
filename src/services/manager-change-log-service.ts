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
// Was a silent, unconditional LIMIT 200 for the unfiltered case with no way
// to page further - now genuinely paginated either way.
export async function listManagerChanges(userId: string | undefined, page: number, limit: number) {
  const whereClause = userId ? "WHERE user_id = $1" : "";
  const baseParams = userId ? [userId] : [];

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM manager_change_log ${whereClause}`,
    baseParams
  );

  const offset = (page - 1) * limit;
  const listParams = [...baseParams, limit, offset];
  const result = await pool.query<ManagerChangeLogRow>(
    `SELECT * FROM manager_change_log ${whereClause} ORDER BY changed_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { entries: result.rows.map(toPublicEntry), total: Number(countResult.rows[0].count) };
}
