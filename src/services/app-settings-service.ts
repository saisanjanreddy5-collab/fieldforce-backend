import { pool } from "../config/db";
import { ApiError } from "../utils/api-error";

interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export async function getSetting(key: string): Promise<{ key: string; value: string; updatedAt: string }> {
  const result = await pool.query<AppSettingRow>("SELECT * FROM app_settings WHERE key = $1", [key]);
  if (result.rows.length === 0) {
    throw new ApiError(404, `Setting '${key}' not found`);
  }
  const row = result.rows[0];
  return { key: row.key, value: row.value, updatedAt: row.updated_at };
}

export async function setSetting(key: string, value: string) {
  const result = await pool.query<AppSettingRow>(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING *`,
    [key, value]
  );
  const row = result.rows[0];
  return { key: row.key, value: row.value, updatedAt: row.updated_at };
}
