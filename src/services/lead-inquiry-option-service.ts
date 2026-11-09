import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

type InquiryOptionFieldType = "category" | "source";

interface LeadInquiryOptionRow {
  id: string;
  field_type: InquiryOptionFieldType;
  label: string;
  is_active: boolean;
}

function toPublicOption(row: LeadInquiryOptionRow) {
  return {
    id: row.id,
    fieldType: row.field_type,
    label: row.label,
    isActive: row.is_active,
  };
}

export async function listLeadInquiryOptions(fieldType?: InquiryOptionFieldType) {
  const result = fieldType
    ? await pool.query<LeadInquiryOptionRow>(
        "SELECT * FROM lead_inquiry_options WHERE field_type = $1 ORDER BY label ASC",
        [fieldType]
      )
    : await pool.query<LeadInquiryOptionRow>("SELECT * FROM lead_inquiry_options ORDER BY field_type ASC, label ASC");
  return result.rows.map(toPublicOption);
}

export interface CreateLeadInquiryOptionInput {
  fieldType: InquiryOptionFieldType;
  label: string;
}

export async function createLeadInquiryOption(input: CreateLeadInquiryOptionInput) {
  const existing = await pool.query(
    "SELECT 1 FROM lead_inquiry_options WHERE field_type = $1 AND label = $2",
    [input.fieldType, input.label]
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new ApiError(409, `'${input.label}' already exists for this field`);
  }

  const result = await pool.query<LeadInquiryOptionRow>(
    `INSERT INTO lead_inquiry_options (field_type, label) VALUES ($1,$2) RETURNING *`,
    [input.fieldType, input.label]
  );
  return toPublicOption(result.rows[0]);
}

export interface UpdateLeadInquiryOptionInput {
  label?: string;
  isActive?: boolean;
}

export async function updateLeadInquiryOption(id: string, updates: UpdateLeadInquiryOptionInput) {
  const fieldMap: Record<string, unknown> = {
    label: updates.label,
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
    const existing = await pool.query<LeadInquiryOptionRow>("SELECT * FROM lead_inquiry_options WHERE id = $1", [id]);
    if (existing.rows.length === 0) throw new ApiError(404, "Option not found");
    return toPublicOption(existing.rows[0]);
  }

  setClauses.push("updated_at = now()");
  params.push(id);
  const result = await pool.query<LeadInquiryOptionRow>(
    `UPDATE lead_inquiry_options SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Option not found");
  }
  return toPublicOption(result.rows[0]);
}
