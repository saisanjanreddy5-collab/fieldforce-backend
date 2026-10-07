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
