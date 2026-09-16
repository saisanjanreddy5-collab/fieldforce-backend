import { pool } from "../config/db";
import { Role, ROLES } from "../utils/roles";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string | null;
  manager_id: string | null;
  smartflo_agent_number: string | null;
  is_active: boolean;
  created_at: string;
}

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    designation: row.designation,
    managerId: row.manager_id,
    smartfloAgentNumber: row.smartflo_agent_number,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

// An Admin manages the whole org; a Manager only needs to see their own
// reporting subtree when picking a manager or reviewing their team.
export async function listUsers(requestingUserId: string, requestingRole: Role) {
  if (requestingRole === ROLES.ADMIN) {
    const result = await pool.query<UserRow>("SELECT * FROM users WHERE is_active = true ORDER BY name ASC");
    return result.rows.map(toPublicUser);
  }

  const result = await pool.query<UserRow>(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM users WHERE id = $1
       UNION ALL
       SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
     )
     SELECT u.* FROM users u
     INNER JOIN subtree s ON u.id = s.id
     WHERE u.is_active = true
     ORDER BY u.name ASC`,
    [requestingUserId]
  );
  return result.rows.map(toPublicUser);
}
