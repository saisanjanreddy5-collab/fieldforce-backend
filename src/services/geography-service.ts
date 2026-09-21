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
