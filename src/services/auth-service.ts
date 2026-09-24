import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { getPermissionsForRole } from "./permission-service";
import { getLevelSecurityTier } from "./level-service";
import { Role } from "../utils/roles";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  designation: string | null;
  manager_id: string | null;
  dotted_line_manager_id: string | null;
  sales_team_id: string | null;
  zone_id: string | null;
  state_id: string | null;
  district_id: string | null;
  area_id: string | null;
  smartflo_agent_number: string | null;
  mobile: string | null;
  territory: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
  status: string;
  level_id: string | null;
  office_id: string | null;
  division_channel_id: string | null;
  customer_category_id: string | null;
  is_active: boolean;
  created_at: string;
  // Only present on the joined query getUserById runs (for /auth/me) -
  // every other caller here (register/login/refresh) selects plain
  // `users` rows, so these come back undefined for them and toPublicUser
  // reports null, which is accurate: those call sites never looked it up.
  manager_name?: string | null;
  sales_team_name?: string | null;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  // Optional - a Level's security_tier wins when levelId is given (see the
  // role derivation below); this is only used as a fallback for accounts
  // with no Level. The validator's refine() guarantees at least one of the
  // two is present by the time this runs.
  role?: Role;
  designation?: string;
  managerId?: string;
  dottedLineManagerId?: string;
  salesTeamId?: string;
  zoneId?: string;
  stateId?: string;
  districtId?: string;
  areaId?: string;
  smartfloAgentNumber?: string;
  mobile?: string;
  territory?: string;
  employeeCode?: string;
  dateOfJoining?: string;
  status?: string;
  levelId?: string;
  officeId?: string;
  divisionChannelId?: string;
  customerCategoryId?: string;
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
    salesTeamId: row.sales_team_id,
    zoneId: row.zone_id,
    stateId: row.state_id,
    districtId: row.district_id,
    areaId: row.area_id,
    smartfloAgentNumber: row.smartflo_agent_number,
    mobile: row.mobile,
    territory: row.territory,
    employeeCode: row.employee_code,
    dateOfJoining: row.date_of_joining,
    status: row.status,
    levelId: row.level_id,
    officeId: row.office_id,
    divisionChannelId: row.division_channel_id,
    customerCategoryId: row.customer_category_id,
    isActive: row.is_active,
    managerName: row.manager_name ?? null,
    salesTeamName: row.sales_team_name ?? null,
  };
}

// Session-facing responses (login, /auth/me) additionally carry the user's
// current permission set, from the same role_permissions catalog Phase 3A
// introduced - the frontend consumes this for UX-only action gating. Kept
// separate from toPublicUser (used elsewhere, e.g. registerUser's response)
// since those call sites have no session/permissions concept.
async function toPublicUserWithPermissions(row: UserRow) {
  const permissions = await getPermissionsForRole(row.role);
  return { ...toPublicUser(row), permissions };
}

function signAccessToken(user: UserRow): string {
  return jwt.sign({ id: user.id, role: user.role, managerId: user.manager_id }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

function signRefreshToken(user: UserRow): string {
  return jwt.sign({ id: user.id }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export async function registerUser(input: RegisterInput) {
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [input.email]);
  if (existing.rows.length > 0) {
    throw new ApiError(409, "A user with this email already exists");
  }

  if (input.territory) {
    const territoryTaken = await pool.query<{ id: string }>("SELECT id FROM users WHERE territory = $1", [
      input.territory,
    ]);
    if (territoryTaken.rows.length > 0) {
      throw new ApiError(409, "This territory is already assigned to another salesperson");
    }
  }

  if (input.employeeCode) {
    const codeTaken = await pool.query<{ id: string }>("SELECT id FROM users WHERE employee_code = $1", [
      input.employeeCode,
    ]);
    if (codeTaken.rows.length > 0) {
      throw new ApiError(409, "This employee code is already in use");
    }
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  // Picking a Level is what actually determines real backend access, not
  // just a display label - a level's security_tier wins over any role the
  // caller passed directly, so the wizard's Level picker can't drift out of
  // sync with what the account can actually do. Callers with no level
  // (seedAdmin.ts, and anyone marked Administrator/Finance with no ladder
  // position) still pass role directly.
  const role = input.levelId ? await getLevelSecurityTier(input.levelId) : input.role;

  const result = await pool.query<UserRow>(
    `INSERT INTO users (
       name, email, password_hash, role, designation, manager_id, dotted_line_manager_id, sales_team_id, zone_id, state_id, district_id, area_id,
       smartflo_agent_number, mobile, territory, employee_code, date_of_joining, status, level_id, office_id, division_channel_id, customer_category_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, COALESCE($18, 'active'), $19, $20, $21, $22)
     RETURNING *`,
    [
      input.name,
      input.email,
      passwordHash,
      role,
      input.designation ?? null,
      input.managerId ?? null,
      input.dottedLineManagerId ?? null,
      input.salesTeamId ?? null,
      input.zoneId ?? null,
      input.stateId ?? null,
      input.districtId ?? null,
      input.areaId ?? null,
      input.smartfloAgentNumber ?? null,
      input.mobile ?? null,
      input.territory ?? null,
      input.employeeCode ?? null,
      input.dateOfJoining ?? null,
      input.status ?? null,
      input.levelId ?? null,
      input.officeId ?? null,
      input.divisionChannelId ?? null,
      input.customerCategoryId ?? null,
    ]
  );

  return toPublicUser(result.rows[0]);
}

export async function loginUser(email: string, password: string) {
  const result = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
  const user = result.rows[0];

  if (!user || !user.is_active) {
    throw new ApiError(401, "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid email or password");
  }

  return {
    user: await toPublicUserWithPermissions(user),
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

export async function refreshAccessToken(refreshToken: string) {
  let payload: { id: string };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { id: string };
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const result = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [payload.id]);
  const user = result.rows[0];

  if (!user || !user.is_active) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  return { accessToken: signAccessToken(user) };
}

export async function getUserById(id: string) {
  const result = await pool.query<UserRow>(
    `SELECT u.*, m.name AS manager_name, st.name AS sales_team_name
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     LEFT JOIN sales_teams st ON st.id = u.sales_team_id
     WHERE u.id = $1`,
    [id]
  );
  const user = result.rows[0];
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  return toPublicUserWithPermissions(user);
}
