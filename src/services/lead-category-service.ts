import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface LeadCategoryRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

function toPublicCategory(row: LeadCategoryRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export async function listLeadCategories() {
  const result = await pool.query<LeadCategoryRow>("SELECT * FROM lead_categories ORDER BY sort_order ASC");
  return result.rows.map(toPublicCategory);
}

export interface ListLeadCategoriesFilters {
  page: number;
  limit: number;
}

// Separate from listLeadCategories() above - that unpaginated helper is still
// relied on internally by reorderLeadCategories() below (needs the full
// freshly-ordered set back, not one page of it) and by qr-campaign-service's
// public QR info lookup (resolves a category key to its label, needs every
// category to find a match). This one backs the GET list endpoint only.
export async function listLeadCategoriesPaginated(filters: ListLeadCategoriesFilters) {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM lead_categories");

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  const result = await pool.query<LeadCategoryRow>(
    "SELECT * FROM lead_categories ORDER BY sort_order ASC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return { leadCategories: result.rows.map(toPublicCategory), total: Number(countResult.rows[0].count) };
}

export interface CreateLeadCategoryInput {
  key: string;
  label: string;
  description?: string;
}

export async function createLeadCategory(input: CreateLeadCategoryInput) {
  const existing = await pool.query("SELECT 1 FROM lead_categories WHERE key = $1", [input.key]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new ApiError(409, `A category with key '${input.key}' already exists`);
  }
  const sortOrderResult = await pool.query<{ max: number | null }>("SELECT MAX(sort_order) AS max FROM lead_categories");
  const nextSortOrder = (sortOrderResult.rows[0]?.max ?? 0) + 1;

  const result = await pool.query<LeadCategoryRow>(
    `INSERT INTO lead_categories (key, label, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.key, input.label, input.description ?? null, nextSortOrder]
  );
  return toPublicCategory(result.rows[0]);
}

export interface UpdateLeadCategoryInput {
  label?: string;
  description?: string | null;
  isActive?: boolean;
}

export async function updateLeadCategory(key: string, updates: UpdateLeadCategoryInput) {
  const fieldMap: Record<string, unknown> = {
    label: updates.label,
    description: updates.description,
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
    const existing = await pool.query<LeadCategoryRow>("SELECT * FROM lead_categories WHERE key = $1", [key]);
    if (existing.rows.length === 0) throw new ApiError(404, `Category '${key}' not found`);
    return toPublicCategory(existing.rows[0]);
  }

  setClauses.push("updated_at = now()");
  params.push(key);

  const result = await pool.query<LeadCategoryRow>(
    `UPDATE lead_categories SET ${setClauses.join(", ")} WHERE key = $${params.length} RETURNING *`,
    params
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, `Category '${key}' not found`);
  }
  return toPublicCategory(result.rows[0]);
}

export async function reorderLeadCategories(orderedKeys: string[]) {
  await Promise.all(
    orderedKeys.map((key, index) => pool.query("UPDATE lead_categories SET sort_order = $1 WHERE key = $2", [index + 1, key]))
  );
  return listLeadCategories();
}
