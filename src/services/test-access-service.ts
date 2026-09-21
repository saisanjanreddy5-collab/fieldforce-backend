import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// Read-only simulation for the "Test access as..." picker - it never signs
// in as the target person, it only computes what their real scope already
// resolves to today (same subtree mechanism every other screen uses), so an
// admin can sanity-check a role/level change before making it.
export async function getAccessSummary(targetUserId: string, requestingUserId: string, requestingRole: string) {
  const target = await pool.query<{
    id: string;
    name: string;
    territory: string | null;
    manager_id: string | null;
    manager_name: string | null;
    level_name: string | null;
    approval_ceiling: string | null;
    approval_label_override: string | null;
  }>(
    `SELECT u.id, u.name, u.territory, u.manager_id, m.name AS manager_name,
            l.name AS level_name, l.approval_ceiling, l.approval_label_override
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     LEFT JOIN levels l ON l.id = u.level_id
     WHERE u.id = $1 AND u.is_active = true`,
    [targetUserId]
  );
  if (target.rows.length === 0) {
    throw new ApiError(404, "Person not found");
  }
  const person = target.rows[0];

  // Admins can inspect anyone; everyone else only within their own subtree -
  // same ownership boundary as every other mutation in this app.
  if (requestingRole !== "admin") {
    const inScope = await pool.query(
      `${SUBTREE_CTE} SELECT 1 FROM subtree WHERE id = $2`,
      [requestingUserId, targetUserId]
    );
    if ((inScope.rowCount ?? 0) === 0) {
      throw new ApiError(403, "You can only test access for people in your own reporting tree");
    }
  }

  const [ownLeads, subtreeStats, directReports, peers] = await Promise.all([
    pool.query<{ count: string }>("SELECT COUNT(*) FROM leads WHERE owner_id = $1 AND is_deleted = false", [targetUserId]),
    pool.query<{ people: string; leads: string }>(
      `${SUBTREE_CTE}
       SELECT
         (SELECT COUNT(*) FROM subtree) - 1 AS people,
         (SELECT COUNT(*) FROM leads WHERE is_deleted = false AND owner_id IN (SELECT id FROM subtree) AND owner_id <> $1) AS leads`,
      [targetUserId]
    ),
    pool.query<{ id: string; name: string }>("SELECT id, name FROM users WHERE manager_id = $1 AND is_active = true ORDER BY name ASC", [
      targetUserId,
    ]),
    person.manager_id
      ? pool.query<{ id: string; name: string }>(
          "SELECT id, name FROM users WHERE manager_id = $1 AND id <> $2 AND is_active = true ORDER BY name ASC",
          [person.manager_id, targetUserId]
        )
      : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
  ]);

  return {
    id: person.id,
    name: person.name,
    territory: person.territory,
    managerName: person.manager_name,
    levelName: person.level_name,
    approvesUpTo: person.approval_label_override ?? (person.approval_ceiling === null ? null : Number(person.approval_ceiling)),
    directReports: directReports.rows.map((r) => ({ id: r.id, name: r.name })),
    ownLeadCount: Number(ownLeads.rows[0].count),
    teamPeopleBelow: Number(subtreeStats.rows[0].people),
    teamLeadCountBelow: Number(subtreeStats.rows[0].leads),
    peers: peers.rows.map((r) => ({ id: r.id, name: r.name })),
  };
}
