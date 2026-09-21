import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface OfficeRow {
  id: string;
  name: string;
  region: string | null;
  code: string | null;
  type: string | null;
  address: string | null;
  address_line_2: string | null;
  city: string | null;
  pincode: string | null;
  zone_id: string | null;
  state_id: string | null;
  phone: string | null;
  latitude: string | null;
  longitude: string | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  employee_count: string;
}

export interface CreateOfficeInput {
  name: string;
  region?: string;
  code?: string;
  type?: string;
  address?: string;
  addressLine2?: string;
  city?: string;
  pincode?: string;
  zoneId?: string;
  stateId?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
}

export interface UpdateOfficeInput {
  name?: string;
  region?: string;
  code?: string;
  type?: string;
  address?: string;
  addressLine2?: string;
  city?: string;
  pincode?: string;
  zoneId?: string;
  stateId?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
}

function toPublicOffice(row: OfficeRow) {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    code: row.code,
    type: row.type,
    address: row.address,
    addressLine2: row.address_line_2,
    city: row.city,
    pincode: row.pincode,
    zoneId: row.zone_id,
    stateId: row.state_id,
    phone: row.phone,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    isActive: row.is_active,
    employeeCount: Number(row.employee_count ?? 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// employeeCount is computed here, not stored - users.office_id stays the
// single source of truth. One LATERAL join, no N+1, no loading users into
// JS just to count them.
const EMPLOYEE_COUNT_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count FROM users u WHERE u.office_id = o.id AND u.is_active = true
  ) ec ON true
`;

export async function listOffices() {
  const result = await pool.query<OfficeRow>(
    `SELECT o.*, ec.count AS employee_count FROM offices o ${EMPLOYEE_COUNT_JOIN} ORDER BY o.name ASC`
  );
  return result.rows.map(toPublicOffice);
}

export async function getOfficeById(id: string) {
  const result = await pool.query<OfficeRow>(
    `SELECT o.*, ec.count AS employee_count FROM offices o ${EMPLOYEE_COUNT_JOIN} WHERE o.id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Office not found");
  }
  return toPublicOffice(result.rows[0]);
}

async function assertZoneExists(zoneId: string): Promise<void> {
  const zone = await pool.query<{ id: string }>("SELECT id FROM zones WHERE id = $1", [zoneId]);
  if (zone.rows.length === 0) {
    throw new ApiError(422, "That region does not exist");
  }
}

export async function createOffice(input: CreateOfficeInput, requestingUserId: string) {
  if (input.zoneId) {
    await assertZoneExists(input.zoneId);
  }

  const existingName = await pool.query<{ id: string }>("SELECT id FROM offices WHERE name = $1", [input.name]);
  if (existingName.rows.length > 0) {
    throw new ApiError(409, "An office with this name already exists");
  }

  if (input.code) {
    const existingCode = await pool.query<{ id: string }>("SELECT id FROM offices WHERE code = $1", [input.code]);
    if (existingCode.rows.length > 0) {
      throw new ApiError(409, "An office with this code already exists");
    }
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO offices (
       name, region, code, type, address, address_line_2, city, pincode, zone_id, state_id, phone,
       latitude, longitude, is_active, created_by, updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, true), $15, $15)
     RETURNING id`,
    [
      input.name,
      input.region ?? null,
      input.code ?? null,
      input.type ?? null,
      input.address ?? null,
      input.addressLine2 ?? null,
      input.city ?? null,
      input.pincode ?? null,
      input.zoneId ?? null,
      input.stateId ?? null,
      input.phone ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.isActive ?? null,
      requestingUserId,
    ]
  );

  return getOfficeById(result.rows[0].id);
}

export async function updateOffice(id: string, updates: UpdateOfficeInput, requestingUserId: string) {
  const current = await getOfficeById(id);

  if (updates.zoneId) {
    await assertZoneExists(updates.zoneId);
  }

  if (updates.name && updates.name !== current.name) {
    const nameTaken = await pool.query<{ id: string }>("SELECT id FROM offices WHERE name = $1 AND id <> $2", [
      updates.name,
      id,
    ]);
    if (nameTaken.rows.length > 0) {
      throw new ApiError(409, "An office with this name already exists");
    }
  }

  if (updates.code && updates.code !== current.code) {
    const codeTaken = await pool.query<{ id: string }>("SELECT id FROM offices WHERE code = $1 AND id <> $2", [
      updates.code,
      id,
    ]);
    if (codeTaken.rows.length > 0) {
      throw new ApiError(409, "An office with this code already exists");
    }
  }

  const normalize = (value: string | undefined) => (value === "" ? null : value);
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    region: normalize(updates.region),
    code: normalize(updates.code),
    type: normalize(updates.type),
    address: normalize(updates.address),
    address_line_2: normalize(updates.addressLine2),
    city: normalize(updates.city),
    pincode: normalize(updates.pincode),
    zone_id: normalize(updates.zoneId),
    state_id: normalize(updates.stateId),
    phone: normalize(updates.phone),
    latitude: updates.latitude,
    longitude: updates.longitude,
    is_active: updates.isActive,
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
    return current;
  }

  params.push(requestingUserId);
  setClauses.push(`updated_by = $${params.length}`);
  setClauses.push("updated_at = now()");
  params.push(id);

  await pool.query(`UPDATE offices SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);

  return getOfficeById(id);
}
