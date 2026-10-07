import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface PipelineStageRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  probability: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function toPublicStage(row: PipelineStageRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    probability: row.probability,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export async function listPipelineStages() {
  const result = await pool.query<PipelineStageRow>("SELECT * FROM pipeline_stages ORDER BY sort_order ASC");
  return result.rows.map(toPublicStage);
}

export interface ListPipelineStagesFilters {
  page: number;
  limit: number;
}

// Separate from listPipelineStages() above, which reorderPipelineStages()
// below still calls internally to hand back the full fresh ordering after a
// drag-to-reorder - that caller needs every stage, never a single page of
// them, so it keeps using the unpaginated helper. This one backs the GET
// list endpoint only.
export async function listPipelineStagesPaginated(filters: ListPipelineStagesFilters) {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM pipeline_stages");

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const result = await pool.query<PipelineStageRow>(
    "SELECT * FROM pipeline_stages ORDER BY sort_order ASC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return { pipelineStages: result.rows.map(toPublicStage), total: Number(countResult.rows[0].count) };
}

export interface CreatePipelineStageInput {
  key: string;
  label: string;
  description?: string;
  probability: number;
}

export async function createPipelineStage(input: CreatePipelineStageInput) {
  const existing = await pool.query("SELECT 1 FROM pipeline_stages WHERE key = $1", [input.key]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new ApiError(409, `A stage with key '${input.key}' already exists`);
  }
  const sortOrderResult = await pool.query<{ max: number | null }>("SELECT MAX(sort_order) AS max FROM pipeline_stages");
  const nextSortOrder = (sortOrderResult.rows[0]?.max ?? 0) + 1;

  const result = await pool.query<PipelineStageRow>(
    `INSERT INTO pipeline_stages (key, label, description, probability, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [input.key, input.label, input.description ?? null, input.probability, nextSortOrder]
  );
  return toPublicStage(result.rows[0]);
}

export interface UpdatePipelineStageInput {
  label?: string;
  description?: string | null;
  probability?: number;
  isActive?: boolean;
}

export async function updatePipelineStage(key: string, updates: UpdatePipelineStageInput) {
  const fieldMap: Record<string, unknown> = {
    label: updates.label,
    description: updates.description,
    probability: updates.probability,
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
    const existing = await pool.query<PipelineStageRow>("SELECT * FROM pipeline_stages WHERE key = $1", [key]);
    if (existing.rows.length === 0) throw new ApiError(404, `Stage '${key}' not found`);
    return toPublicStage(existing.rows[0]);
  }

  setClauses.push("updated_at = now()");
  params.push(key);

  const result = await pool.query<PipelineStageRow>(
    `UPDATE pipeline_stages SET ${setClauses.join(", ")} WHERE key = $${params.length} RETURNING *`,
    params
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, `Stage '${key}' not found`);
  }
  return toPublicStage(result.rows[0]);
}

// Drag-to-reorder sends the full ordered key list every time - simplest
// correct way to persist a manual reorder without a fragile "move item A
// between B and C" delta calculation on the frontend.
export async function reorderPipelineStages(orderedKeys: string[]) {
  await Promise.all(
    orderedKeys.map((key, index) => pool.query("UPDATE pipeline_stages SET sort_order = $1 WHERE key = $2", [index + 1, key]))
  );
  return listPipelineStages();
}
