import { pool } from "../config/db";

interface ZoneRow {
  id: string;
  name: string;
}

function toPublicZone(row: ZoneRow) {
  return { id: row.id, name: row.name };
}

export async function listZones() {
  const result = await pool.query<ZoneRow>("SELECT * FROM zones ORDER BY name ASC");
  return result.rows.map(toPublicZone);
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

export async function listStates(zoneId?: string) {
  if (zoneId) {
    const result = await pool.query<StateRow>("SELECT * FROM states WHERE zone_id = $1 ORDER BY name ASC", [zoneId]);
    return result.rows.map(toPublicState);
  }
  const result = await pool.query<StateRow>("SELECT * FROM states ORDER BY name ASC");
  return result.rows.map(toPublicState);
}
