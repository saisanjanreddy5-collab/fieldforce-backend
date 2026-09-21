import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface LevelRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface CreateLevelInput {
  name: string;
  sortOrder?: number;
}

function toPublicLevel(row: LevelRow) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export async function listLevels() {
  const result = await pool.query<LevelRow>("SELECT * FROM levels ORDER BY sort_order ASC, name ASC");
  return result.rows.map(toPublicLevel);
}

export async function createLevel(input: CreateLevelInput) {
  const existing = await pool.query<{ id: string }>("SELECT id FROM levels WHERE name = $1", [input.name]);
  if (existing.rows.length > 0) {
    throw new ApiError(409, "A level with this name already exists");
  }

  const result = await pool.query<LevelRow>(
    "INSERT INTO levels (name, sort_order) VALUES ($1, $2) RETURNING *",
    [input.name, input.sortOrder ?? 0]
  );
  return toPublicLevel(result.rows[0]);
}
