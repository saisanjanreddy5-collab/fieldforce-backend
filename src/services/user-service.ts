import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { Role, ROLES } from "../utils/roles";

export interface UpdateUserInput {
  designation?: string;
  managerId?: string;
  smartfloAgentNumber?: string;
  territory?: string;
  salesTeamId?: string;
  zoneId?: string;
  employeeCode?: string;
  dateOfJoining?: string;
  status?: string;
  levelId?: string;
  officeId?: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string | null;
  manager_id: string | null;
  smartflo_agent_number: string | null;
  territory: string | null;
  sales_team_id: string | null;
  zone_id: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
  status: string;
  level_id: string | null;
  office_id: string | null;
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
    territory: row.territory,
    salesTeamId: row.sales_team_id,
    zoneId: row.zone_id,
    employeeCode: row.employee_code,
    dateOfJoining: row.date_of_joining,
    status: row.status,
    levelId: row.level_id,
    officeId: row.office_id,
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

// Only the "Add user" flow set these fields before now - there was no way to
// go back and set/change a territory or sales team on someone already
// created (including whoever ran the seed script for the very first admin).
export async function updateUser(id: string, updates: UpdateUserInput) {
  if (updates.territory) {
    const territoryTaken = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE territory = $1 AND id <> $2",
      [updates.territory, id]
    );
    if (territoryTaken.rows.length > 0) {
      throw new ApiError(409, "This territory is already assigned to another salesperson");
    }
  }

  if (updates.employeeCode) {
    const codeTaken = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE employee_code = $1 AND id <> $2",
      [updates.employeeCode, id]
    );
    if (codeTaken.rows.length > 0) {
      throw new ApiError(409, "This employee code is already in use");
    }
  }

  const normalize = (value: string | undefined) => (value === "" ? null : value);
  const fieldMap: Record<string, unknown> = {
    designation: normalize(updates.designation),
    manager_id: normalize(updates.managerId),
    smartflo_agent_number: normalize(updates.smartfloAgentNumber),
    territory: normalize(updates.territory),
    sales_team_id: normalize(updates.salesTeamId),
    zone_id: normalize(updates.zoneId),
    employee_code: normalize(updates.employeeCode),
    date_of_joining: normalize(updates.dateOfJoining),
    status: updates.status,
    level_id: normalize(updates.levelId),
    office_id: normalize(updates.officeId),
  };

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) {
    const existing = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      throw new ApiError(404, "User not found");
    }
    return toPublicUser(existing.rows[0]);
  }

  setClauses.push("updated_at = now()");
  params.push(id);

  const result = await pool.query<UserRow>(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "User not found");
  }
  return toPublicUser(result.rows[0]);
}
