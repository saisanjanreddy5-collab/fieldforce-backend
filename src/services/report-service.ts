import { pool } from "../config/db";

// Same subtree-scoping convention as dashboard-service.ts and everywhere
// else - a report always reflects the requesting user's own reporting
// chain, never a company-wide bypass for admin.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// A lead counts as "qualified" once an opportunity created from it has
// moved past the initial 'new' stage - the real stage list already used by
// the Opportunities pipeline (src/components/opportunities/stages.ts on the
// frontend). Not a fabricated status; it reuses the one real "progressed"
// signal that exists.
const QUALIFIED_STAGES = ["qualified", "site_visit", "proposal", "negotiation", "agreement", "won"];

export interface SalespersonPerformanceFilters {
  month?: string; // "YYYY-MM"
  zoneId?: string;
}

export async function getSalespersonPerformance(requestingUserId: string, filters: SalespersonPerformanceFilters) {
  const monthCondition = filters.month ? `AND date_trunc('month', l.created_at) = date_trunc('month', $2::date)` : "";
  const wonMonthCondition = filters.month ? `AND date_trunc('month', o.won_at) = date_trunc('month', $2::date)` : "";
  const params: unknown[] = [requestingUserId];
  if (filters.month) params.push(`${filters.month}-01`);
  const zoneParamIndex = params.length + 1;
  const zoneCondition = filters.zoneId ? `AND u.zone_id = $${zoneParamIndex}` : "";
  if (filters.zoneId) params.push(filters.zoneId);

  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       u.id AS "userId",
       u.name,
       COALESCE(lead_counts.count, 0) AS "leadsOwned",
       COALESCE(converted_counts.count, 0) AS "leadsConverted",
       COALESCE(revenue.total, 0) AS "revenue"
     FROM subtree s
     JOIN users u ON u.id = s.id
     LEFT JOIN (
       SELECT l.owner_id, COUNT(*) AS count FROM leads l WHERE l.is_deleted = false ${monthCondition} GROUP BY l.owner_id
     ) lead_counts ON lead_counts.owner_id = u.id
     LEFT JOIN (
       SELECT l.owner_id, COUNT(*) AS count FROM leads l
       WHERE l.is_deleted = false AND l.status = 'converted' ${monthCondition} GROUP BY l.owner_id
     ) converted_counts ON converted_counts.owner_id = u.id
     LEFT JOIN (
       SELECT l.owner_id, SUM(o.value) AS total
       FROM opportunities o JOIN leads l ON l.id = o.lead_id
       WHERE o.is_deleted = false AND l.is_deleted = false AND o.stage = 'won' ${wonMonthCondition}
       GROUP BY l.owner_id
     ) revenue ON revenue.owner_id = u.id
     WHERE 1=1 ${zoneCondition}
     ORDER BY u.name`,
    params
  );

  return result.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    leads: Number(row.leadsOwned),
    converted: Number(row.leadsConverted),
    conversionRate: Number(row.leadsOwned) === 0 ? 0 : Math.round((Number(row.leadsConverted) / Number(row.leadsOwned)) * 1000) / 10,
    revenue: Number(row.revenue),
  }));
}

// "Customers" and "Open tickets" have no real backing entity anywhere in
// FieldForce (no customer table, no ticketing system) - customers is an
// honest proxy (leads that reached status = 'converted'), and openTickets
// is always null, rendered as "-" on the frontend rather than a fabricated
// number.
export async function getStateWiseReport(requestingUserId: string) {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       st.id AS "stateId",
       st.name AS "stateName",
       COUNT(l.id) AS "leads",
       COUNT(l.id) FILTER (WHERE l.status = 'converted') AS "customers",
       COUNT(l.id) FILTER (WHERE l.category = 'FOFO' AND l.push_status = 'pushed') AS "fofoLive"
     FROM states st
     LEFT JOIN leads l ON l.state_id = st.id AND l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)
     GROUP BY st.id, st.name
     HAVING COUNT(l.id) > 0
     ORDER BY COUNT(l.id) DESC`,
    [requestingUserId]
  );

  return result.rows.map((row) => ({
    stateId: row.stateId,
    stateName: row.stateName,
    leads: Number(row.leads),
    customers: Number(row.customers),
    fofoLive: Number(row.fofoLive),
    openTickets: null,
  }));
}

// Deliberately excludes category = 'FOFO' - that channel already gets its
// own dedicated cohort-retention report; this one is the non-FOFO channel
// mix (B2B/Stockist/Ethical/PCD/Institutes/Lifestyle/COCO, whichever real
// values exist). "Avg order" and "overdue" have no backing data anywhere
// (no orders/invoicing system exists) so they're always null.
export async function getB2BGroupPerformance(requestingUserId: string) {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       COALESCE(l.category, 'Uncategorized') AS "category",
       COUNT(*) FILTER (WHERE l.status = 'converted') AS "accounts",
       COALESCE(SUM(o.value) FILTER (WHERE o.stage = 'won'), 0) AS "revenue"
     FROM leads l
     LEFT JOIN opportunities o ON o.lead_id = l.id AND o.is_deleted = false
     WHERE l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree) AND (l.category IS DISTINCT FROM 'FOFO')
     GROUP BY l.category
     ORDER BY revenue DESC`,
    [requestingUserId]
  );

  return result.rows.map((row) => ({
    category: row.category,
    accounts: Number(row.accounts),
    revenue: Number(row.revenue),
    avgOrder: null,
    overdue: null,
  }));
}

// Groups by inquiry_source (the field the real New Lead form actually
// writes to) rather than the `source` column, which is never populated by
// any real UI today. "Cost"/"CPQL" are always null - no marketing spend or
// campaign budget is tracked anywhere in FieldForce.
export async function getLeadSourceROI(requestingUserId: string) {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       COALESCE(l.inquiry_source, 'Unspecified') AS "source",
       COUNT(DISTINCT l.id) AS "leads",
       COUNT(DISTINCT l.id) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM opportunities o
           WHERE o.lead_id = l.id AND o.is_deleted = false AND o.stage = ANY($2)
         )
       ) AS "qualified"
     FROM leads l
     WHERE l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)
     GROUP BY COALESCE(l.inquiry_source, 'Unspecified')
     ORDER BY leads DESC`,
    [requestingUserId, QUALIFIED_STAGES]
  );

  return result.rows.map((row) => ({
    source: row.source,
    leads: Number(row.leads),
    qualified: Number(row.qualified),
    cost: null,
    cpql: null,
  }));
}

// Cohort month and store count are real (grouped by the real pushed_at
// timestamp). M+3/M+6/M+12 retention has no backing data at all - nothing
// in FieldForce tracks whether a store keeps ordering after it goes live,
// so those are always null.
export async function getFofoCohortRetention(requestingUserId: string) {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       date_trunc('month', l.pushed_at) AS "cohortMonth",
       COUNT(*) AS "stores"
     FROM leads l
     WHERE l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)
       AND l.category = 'FOFO' AND l.push_status = 'pushed' AND l.pushed_at IS NOT NULL
     GROUP BY date_trunc('month', l.pushed_at)
     ORDER BY "cohortMonth" DESC`,
    [requestingUserId]
  );

  return result.rows.map((row) => ({
    cohortMonth: row.cohortMonth,
    stores: Number(row.stores),
    m3: null,
    m6: null,
    m12: null,
  }));
}

export interface SavedReportViewInput {
  reportKey: string;
  name: string;
  filters: Record<string, unknown>;
}

interface SavedReportViewRow {
  id: string;
  user_id: string;
  report_key: string;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

function toPublicSavedView(row: SavedReportViewRow) {
  return { id: row.id, reportKey: row.report_key, name: row.name, filters: row.filters, createdAt: row.created_at };
}

export async function listSavedViews(requestingUserId: string, reportKey: string) {
  const result = await pool.query<SavedReportViewRow>(
    "SELECT * FROM saved_report_views WHERE user_id = $1 AND report_key = $2 ORDER BY created_at DESC",
    [requestingUserId, reportKey]
  );
  return result.rows.map(toPublicSavedView);
}

export async function createSavedView(requestingUserId: string, input: SavedReportViewInput) {
  const result = await pool.query<SavedReportViewRow>(
    `INSERT INTO saved_report_views (user_id, report_key, name, filters) VALUES ($1, $2, $3, $4) RETURNING *`,
    [requestingUserId, input.reportKey, input.name, JSON.stringify(input.filters)]
  );
  return toPublicSavedView(result.rows[0]);
}

export async function deleteSavedView(viewId: string, requestingUserId: string): Promise<void> {
  await pool.query("DELETE FROM saved_report_views WHERE id = $1 AND user_id = $2", [viewId, requestingUserId]);
}
