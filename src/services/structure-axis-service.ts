import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface StructureAxisRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
}

function toPublicAxis(row: StructureAxisRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    isEnabled: row.is_enabled,
    sortOrder: row.sort_order,
  };
}

export interface ListStructureAxesFilters {
  page: number;
  limit: number;
}

export async function listStructureAxes(filters: ListStructureAxesFilters) {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM structure_axes");

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const result = await pool.query<StructureAxisRow>(
    "SELECT * FROM structure_axes ORDER BY sort_order ASC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return { structureAxes: result.rows.map(toPublicAxis), total: Number(countResult.rows[0].count) };
}

// Toggle only - per the approved Phase 3 scope, this table has no lookup
// data behind product_division/customer_category/channel, so there is
// nothing else to update on an axis besides whether it's switched on.
export async function setAxisEnabled(id: string, isEnabled: boolean) {
  const result = await pool.query<StructureAxisRow>(
    "UPDATE structure_axes SET is_enabled = $1 WHERE id = $2 RETURNING *",
    [isEnabled, id]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Structure axis not found");
  }
  return toPublicAxis(result.rows[0]);
}
