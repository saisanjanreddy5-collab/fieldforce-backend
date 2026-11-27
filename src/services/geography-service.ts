import { pool } from "../config/db";

interface ZoneRow {
  id: string;
  name: string;
}

function toPublicZone(row: ZoneRow) {
  return { id: row.id, name: row.name };
}

export async function listZones(page: number, limit: number) {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM zones");
  const offset = (page - 1) * limit;
  const result = await pool.query<ZoneRow>("SELECT * FROM zones ORDER BY name ASC LIMIT $1 OFFSET $2", [limit, offset]);
  return { zones: result.rows.map(toPublicZone), total: Number(countResult.rows[0].count) };
}

interface StateRow {
  id: string;
  name: string;
  zone_id: string;
  gst_code: string | null;
}

function toPublicState(row: StateRow) {
  return { id: row.id, name: row.name, zoneId: row.zone_id, gstCode: row.gst_code };
}

export async function listStates(zoneId: string | undefined, page: number, limit: number) {
  const whereClause = zoneId ? "WHERE zone_id = $1" : "";
  const baseParams = zoneId ? [zoneId] : [];

  const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM states ${whereClause}`, baseParams);

  const offset = (page - 1) * limit;
  const listParams = [...baseParams, limit, offset];
  const result = await pool.query<StateRow>(
    `SELECT * FROM states ${whereClause} ORDER BY name ASC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  return { states: result.rows.map(toPublicState), total: Number(countResult.rows[0].count) };
}

// "Cities" in the API are rows of the districts table (India Post districts).
interface CityRow {
  id: string;
  name: string;
  state_id: string;
}

export async function listCities(stateId: string, search: string | undefined) {
  const params: string[] = [stateId];
  let where = "WHERE state_id = $1";
  if (search) {
    params.push(`%${search}%`);
    where += ` AND name ILIKE $${params.length}`;
  }
  const result = await pool.query<CityRow>(`SELECT id, name, state_id FROM districts ${where} ORDER BY name ASC`, params);
  return result.rows.map((r) => ({ id: r.id, name: r.name, stateId: r.state_id }));
}

interface AreaRow {
  id: string;
  name: string;
  pincode: string | null;
  latitude: string | null;
  longitude: string | null;
  city_id: string;
  city_name: string;
  state_id: string;
  state_name: string;
}

// By city (the State -> City -> Area dropdown) or by pincode (typing a
// pincode fills in its area, city and state).
export async function listAreas(filters: { cityId?: string; pincode?: string; search?: string }) {
  const params: string[] = [];
  const conditions: string[] = [];
  if (filters.cityId) {
    params.push(filters.cityId);
    conditions.push(`a.district_id = $${params.length}`);
  }
  if (filters.pincode) {
    params.push(filters.pincode);
    conditions.push(`a.pincode = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(a.name ILIKE $${params.length} OR a.pincode LIKE $${params.length})`);
  }
  const result = await pool.query<AreaRow>(
    `SELECT a.id, a.name, a.pincode, a.latitude, a.longitude,
            d.id AS city_id, d.name AS city_name, s.id AS state_id, s.name AS state_name
     FROM areas a
     JOIN districts d ON d.id = a.district_id
     JOIN states s ON s.id = d.state_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.name ASC, a.pincode ASC`,
    params
  );
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    pincode: r.pincode,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    cityId: r.city_id,
    cityName: r.city_name,
    stateId: r.state_id,
    stateName: r.state_name,
  }));
}
