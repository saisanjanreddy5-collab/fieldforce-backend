import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { getLevelSecurityTier } from "./level-service";
import { Role, ROLES } from "../utils/roles";

export interface UpdateUserInput {
  designation?: string;
  managerId?: string;
  dottedLineManagerId?: string;
  smartfloAgentNumber?: string;
  mobile?: string;
  territory?: string;
  salesTeamId?: string;
  zoneId?: string;
  stateId?: string;
  employeeCode?: string;
  dateOfJoining?: string;
  status?: string;
  levelId?: string;
  officeId?: string;
  divisionChannelId?: string;
  customerCategoryId?: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string | null;
  manager_id: string | null;
  dotted_line_manager_id: string | null;
  smartflo_agent_number: string | null;
  mobile: string | null;
  territory: string | null;
  sales_team_id: string | null;
  zone_id: string | null;
  state_id: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
  status: string;
  level_id: string | null;
  office_id: string | null;
  division_channel_id: string | null;
  customer_category_id: string | null;
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
    dottedLineManagerId: row.dotted_line_manager_id,
    smartfloAgentNumber: row.smartflo_agent_number,
    mobile: row.mobile,
    territory: row.territory,
    salesTeamId: row.sales_team_id,
    zoneId: row.zone_id,
    stateId: row.state_id,
    employeeCode: row.employee_code,
    dateOfJoining: row.date_of_joining,
    status: row.status,
    levelId: row.level_id,
    officeId: row.office_id,
    divisionChannelId: row.division_channel_id,
    customerCategoryId: row.customer_category_id,
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
export async function updateUser(id: string, updates: UpdateUserInput, changedBy: string) {
  const managerIdProvided = updates.managerId !== undefined;
  let previousManagerId: string | null = null;
  if (managerIdProvided) {
    const existing = await pool.query<{ manager_id: string | null }>("SELECT manager_id FROM users WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      throw new ApiError(404, "User not found");
    }
    previousManagerId = existing.rows[0].manager_id;
  }

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

  // Same rule as registration: changing someone's Level actually changes
  // their real security tier, not just the label shown for them. Clearing
  // the level (levelId === "") leaves role untouched - there's no tier to
  // derive from "no level".
  const role = updates.levelId ? await getLevelSecurityTier(updates.levelId) : undefined;

  const normalize = (value: string | undefined) => (value === "" ? null : value);
  const fieldMap: Record<string, unknown> = {
    designation: normalize(updates.designation),
    manager_id: normalize(updates.managerId),
    dotted_line_manager_id: normalize(updates.dottedLineManagerId),
    smartflo_agent_number: normalize(updates.smartfloAgentNumber),
    mobile: normalize(updates.mobile),
    territory: normalize(updates.territory),
    sales_team_id: normalize(updates.salesTeamId),
    zone_id: normalize(updates.zoneId),
    state_id: normalize(updates.stateId),
    employee_code: normalize(updates.employeeCode),
    date_of_joining: normalize(updates.dateOfJoining),
    status: updates.status,
    level_id: normalize(updates.levelId),
    office_id: normalize(updates.officeId),
    division_channel_id: normalize(updates.divisionChannelId),
    customer_category_id: normalize(updates.customerCategoryId),
    role,
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

  if (managerIdProvided) {
    const newManagerId = result.rows[0].manager_id;
    if (newManagerId !== previousManagerId) {
      await pool.query(
        `INSERT INTO manager_change_log (user_id, old_manager_id, new_manager_id, changed_by) VALUES ($1, $2, $3, $4)`,
        [id, previousManagerId, newManagerId, changedBy]
      );
    }
  }

  return toPublicUser(result.rows[0]);
}
