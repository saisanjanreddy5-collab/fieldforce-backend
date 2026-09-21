import { pool } from "../config/db";

interface DivisionChannelRow {
  id: string;
  label: string;
}

function toPublicDivisionChannel(row: DivisionChannelRow) {
  return { id: row.id, label: row.label };
}

export async function listDivisionChannels() {
  const result = await pool.query<DivisionChannelRow>("SELECT id, label FROM division_channels ORDER BY sort_order ASC");
  return result.rows.map(toPublicDivisionChannel);
}

interface CustomerCategoryRow {
  id: string;
  label: string;
}

function toPublicCustomerCategory(row: CustomerCategoryRow) {
  return { id: row.id, label: row.label };
}

export async function listCustomerCategories() {
  const result = await pool.query<CustomerCategoryRow>("SELECT id, label FROM customer_categories ORDER BY sort_order ASC");
  return result.rows.map(toPublicCustomerCategory);
}
