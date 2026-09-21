import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

interface SalesTeamRow {
  id: string;
  name: string;
  region: string | null;
  created_at: string;
}

export interface CreateSalesTeamInput {
  name: string;
  region?: string;
}

function toPublicSalesTeam(row: SalesTeamRow) {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    createdAt: row.created_at,
  };
}

export async function listSalesTeams() {
  const result = await pool.query<SalesTeamRow>("SELECT * FROM sales_teams ORDER BY name ASC");
  return result.rows.map(toPublicSalesTeam);
}

export async function createSalesTeam(input: CreateSalesTeamInput) {
  const existing = await pool.query<{ id: string }>("SELECT id FROM sales_teams WHERE name = $1", [input.name]);
  if (existing.rows.length > 0) {
    throw new ApiError(409, "A sales team with this name already exists");
  }

  const result = await pool.query<SalesTeamRow>(
    "INSERT INTO sales_teams (name, region) VALUES ($1, $2) RETURNING *",
    [input.name, input.region ?? null]
  );
  return toPublicSalesTeam(result.rows[0]);
}
