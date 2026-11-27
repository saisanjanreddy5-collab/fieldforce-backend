import { PoolClient } from "pg";
import { pool } from "../config/db";
import { ApiError } from "../utils/api-error";
import { ADMIN_AWARE_SUBTREE_CTE } from "../utils/subtree";

// One location a person covers. Only stateId = the whole state; stateId +
// cityId = the whole city; all three = that one area. "City" is a row of
// the districts table (see geography-service.ts).
export interface TerritoryInput {
  stateId: string;
  cityId?: string;
  areaId?: string;
}

export interface TerritoryDetail {
  id: string;
  stateId: string;
  stateName: string;
  cityId: string | null;
  cityName: string | null;
  areaId: string | null;
  areaName: string | null;
  pincode: string | null;
}

// Checks every id exists and belongs to its parent (a city of that state,
// an area of that city), drops exact repeats, and works out every pincode
// the picks cover - those become the person's employee_pincodes, which is
// what Field Sales lead matching reads.
export async function resolveTerritories(input: TerritoryInput[]): Promise<{ territories: TerritoryInput[]; pincodes: string[] }> {
  const seen = new Set<string>();
  const territories = input.filter((t) => {
    const key = `${t.stateId}|${t.cityId ?? ""}|${t.areaId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (territories.length === 0) return { territories, pincodes: [] };

  const found = await pool.query<{ idx: string; state_ok: string | null; city_state: string | null; area_city: string | null }>(
    `SELECT t.idx, s.id AS state_ok, d.state_id AS city_state, a.district_id AS area_city
     FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) WITH ORDINALITY AS t(state_id, city_id, area_id, idx)
     LEFT JOIN states s ON s.id = t.state_id
     LEFT JOIN districts d ON d.id = t.city_id
     LEFT JOIN areas a ON a.id = t.area_id
     ORDER BY t.idx`,
    [territories.map((t) => t.stateId), territories.map((t) => t.cityId ?? null), territories.map((t) => t.areaId ?? null)]
  );
  found.rows.forEach((row, i) => {
    const t = territories[i];
    if (!row.state_ok) throw new ApiError(422, `Location ${i + 1}: state not found`);
    if (t.cityId && row.city_state !== t.stateId) throw new ApiError(422, `Location ${i + 1}: that city is not in the selected state`);
    if (t.areaId && row.area_city !== t.cityId) throw new ApiError(422, `Location ${i + 1}: that area is not in the selected city`);
  });

  const areaIds = territories.filter((t) => t.areaId).map((t) => t.areaId);
  const cityIds = territories.filter((t) => t.cityId && !t.areaId).map((t) => t.cityId);
  const stateIds = territories.filter((t) => !t.cityId).map((t) => t.stateId);
  const pins = await pool.query<{ pincode: string }>(
    `SELECT DISTINCT a.pincode FROM areas a
     JOIN districts d ON d.id = a.district_id
     WHERE a.pincode IS NOT NULL
       AND (a.id = ANY($1::uuid[]) OR a.district_id = ANY($2::uuid[]) OR d.state_id = ANY($3::uuid[]))
     ORDER BY a.pincode`,
    [areaIds, cityIds, stateIds]
  );
  return { territories, pincodes: pins.rows.map((r) => r.pincode) };
}

// Full replace inside the caller's transaction - [] clears every location.
export async function saveTerritories(client: PoolClient, userId: string, territories: TerritoryInput[]): Promise<void> {
  await client.query("DELETE FROM user_territories WHERE user_id = $1", [userId]);
  if (territories.length === 0) return;
  await client.query(
    `INSERT INTO user_territories (user_id, state_id, district_id, area_id)
     SELECT $1, * FROM unnest($2::uuid[], $3::uuid[], $4::uuid[])`,
    [userId, territories.map((t) => t.stateId), territories.map((t) => t.cityId ?? null), territories.map((t) => t.areaId ?? null)]
  );
}

// Same rows with names, for the user objects the API returns - a LATERAL
// join in the same style as PINCODES_JOIN (user-service.ts).
export const TERRITORIES_JOIN = `
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
             'id', ut.id,
             'stateId', s.id, 'stateName', s.name,
             'cityId', d.id, 'cityName', d.name,
             'areaId', a.id, 'areaName', a.name,
             'pincode', a.pincode
           ) ORDER BY s.name, d.name NULLS FIRST, a.name NULLS FIRST) AS territories
    FROM user_territories ut
    JOIN states s ON s.id = ut.state_id
    LEFT JOIN districts d ON d.id = ut.district_id
    LEFT JOIN areas a ON a.id = ut.area_id
    WHERE ut.user_id = u.id
  ) terr ON true
`;

// GET /users/territories - every person with locations (or just one), with
// the names behind each id and the pincodes those locations give them.
// requesterId set -> only people in that requester's own reporting tree
// (an Admin's tree is the whole company), same reach as GET /users.
export async function listUserTerritories(userId: string | undefined, requesterId?: string) {
  const params: string[] = [];
  const scope = requesterId ? (params.push(requesterId), `${ADMIN_AWARE_SUBTREE_CTE}`) : "";
  let where = "terr.territories IS NOT NULL";
  if (userId) {
    params.push(userId);
    where = `u.id = $${params.length}`;
  }
  const result = await pool.query<{ user_id: string; user_name: string; territories: TerritoryDetail[] | null; pincodes: string[] | null }>(
    `${scope}
     SELECT u.id AS user_id, u.name AS user_name, terr.territories,
            (SELECT array_agg(pincode ORDER BY pincode) FROM employee_pincodes WHERE user_id = u.id) AS pincodes
     FROM users u
     ${requesterId ? "INNER JOIN subtree st ON st.id = u.id" : ""}
     ${TERRITORIES_JOIN}
     WHERE ${where}
     ORDER BY u.name ASC`,
    params
  );
  return result.rows.map((r) => ({ userId: r.user_id, userName: r.user_name, territories: r.territories ?? [], pincodes: r.pincodes ?? [] }));
}
