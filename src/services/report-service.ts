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
       WHERE l.is_deleted = false AND l.status = 'Converted' ${monthCondition} GROUP BY l.owner_id
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
       COUNT(l.id) FILTER (WHERE l.status = 'Converted') AS "customers",
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
       COUNT(*) FILTER (WHERE l.status = 'Converted') AS "accounts",
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

// Builds a reusable "created_at BETWEEN from/to" fragment, inclusive of the
// whole `to` day - shared verbatim across every subquery below that filters
// its own activities/audit_log/leads rows by this same date range (each
// subquery's own FROM makes the unqualified `created_at` unambiguous).
function dateRangeCondition(params: unknown[], filters: { from?: string; to?: string }): string {
  let condition = "";
  if (filters.from) {
    params.push(filters.from);
    condition += ` AND created_at >= $${params.length}::date`;
  }
  if (filters.to) {
    params.push(filters.to);
    condition += ` AND created_at < ($${params.length}::date + interval '1 day')`;
  }
  return condition;
}

export interface CallCenterPerformanceFilters {
  from?: string; // "YYYY-MM-DD"
  to?: string;
  employeeIds?: string[];
}

// Calls+dispositions straight from activities (type='call'), escalation/
// qualification rate from audit_log - the same two sources that already
// power the Lead Detail History tab and the Leads export, just aggregated
// per person instead of per lead. escalationRate is one blended rate, not a
// simplification: an FLC-team person can only ever produce 'escalated'
// events and an SLC-team person can only ever produce the SLC->Qualified
// 'status_changed' events (sales_team_id scoping keeps these mutually
// exclusive per person today), so summing both into one numerator is
// correct for whichever tier a given row's person actually works.
export async function getCallCenterPerformance(requestingUserId: string, filters: CallCenterPerformanceFilters) {
  const params: unknown[] = [requestingUserId];
  const callsDateCondition = dateRangeCondition(params, filters);
  const auditDateCondition = dateRangeCondition(params, filters);
  let employeeCondition = "";
  if (filters.employeeIds && filters.employeeIds.length > 0) {
    params.push(filters.employeeIds);
    employeeCondition = `AND u.id = ANY($${params.length})`;
  }

  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       u.id AS "userId",
       u.name,
       st.name AS "team",
       COALESCE(calls.total, 0) AS "callsMade",
       COALESCE(calls.ringing, 0) AS "ringing",
       COALESCE(calls.not_reachable, 0) AS "notReachable",
       COALESCE(calls.switched_off, 0) AS "switchedOff",
       COALESCE(calls.language, 0) AS "language",
       COALESCE(calls.call_back, 0) AS "callBack",
       COALESCE(calls.interested, 0) AS "interested",
       COALESCE(calls.not_interested, 0) AS "notInterested",
       COALESCE(calls.leads_called, 0) AS "leadsCalled",
       COALESCE(esc.count, 0) AS "escalatedOrQualified"
     FROM subtree s
     JOIN users u ON u.id = s.id
     LEFT JOIN sales_teams st ON st.id = u.sales_team_id
     LEFT JOIN (
       SELECT created_by,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE details->>'disposition' = 'Ringing') AS ringing,
         COUNT(*) FILTER (WHERE details->>'disposition' = 'Not Reachable') AS not_reachable,
         COUNT(*) FILTER (WHERE details->>'disposition' = 'Switched Off') AS switched_off,
         COUNT(*) FILTER (WHERE details->>'disposition' = 'Language') AS language,
         COUNT(*) FILTER (WHERE details->>'disposition' = 'Call Back') AS call_back,
         COUNT(*) FILTER (WHERE details->>'disposition' = 'Call Done And Interested') AS interested,
         COUNT(*) FILTER (WHERE details->>'disposition' = 'Call Done And Not Interested') AS not_interested,
         COUNT(DISTINCT lead_id) AS leads_called
       FROM activities
       WHERE type = 'call' ${callsDateCondition}
       GROUP BY created_by
     ) calls ON calls.created_by = u.id
     LEFT JOIN (
       SELECT actor_id, COUNT(*) AS count
       FROM audit_log
       WHERE entity_type = 'lead'
         AND (action = 'escalated' OR (action = 'status_changed' AND old_value = 'SLC' AND new_value = 'Qualified'))
         ${auditDateCondition}
       GROUP BY actor_id
     ) esc ON esc.actor_id = u.id
     WHERE u.role = 'call_center' ${employeeCondition}
     ORDER BY u.name`,
    params
  );

  return result.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    team: row.team,
    callsMade: Number(row.callsMade),
    dispositions: {
      ringing: Number(row.ringing),
      notReachable: Number(row.notReachable),
      switchedOff: Number(row.switchedOff),
      language: Number(row.language),
      callBack: Number(row.callBack),
      interested: Number(row.interested),
      notInterested: Number(row.notInterested),
    },
    leadsCalled: Number(row.leadsCalled),
    escalatedOrQualified: Number(row.escalatedOrQualified),
    escalationRate:
      Number(row.leadsCalled) === 0 ? 0 : Math.round((Number(row.escalatedOrQualified) / Number(row.leadsCalled)) * 1000) / 10,
  }));
}

export interface FieldSalesPerformanceFilters {
  from?: string;
  to?: string;
  employeeIds?: string[];
}

// Leads received/converted stay bucketed by the lead's own created_at - same
// convention getSalespersonPerformance above already uses (reconstructing a
// true "date it reached this field rep" would mean fragile text-matching
// against owner_reassigned's name-only snapshots, for a metric whose own
// precedent already accepts this coarser convention). Site visits use the
// real activities.created_at - an honest timestamp, no caveat needed.
export async function getFieldSalesPerformance(requestingUserId: string, filters: FieldSalesPerformanceFilters) {
  const params: unknown[] = [requestingUserId];
  const leadsDateCondition = dateRangeCondition(params, filters);
  const visitsDateCondition = dateRangeCondition(params, filters);
  let employeeCondition = "";
  if (filters.employeeIds && filters.employeeIds.length > 0) {
    params.push(filters.employeeIds);
    employeeCondition = `AND u.id = ANY($${params.length})`;
  }

  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       u.id AS "userId",
       u.name,
       COALESCE(received.count, 0) AS "leadsReceived",
       COALESCE(converted.count, 0) AS "leadsConverted",
       COALESCE(visits.count, 0) AS "siteVisitsLogged"
     FROM subtree s
     JOIN users u ON u.id = s.id
     LEFT JOIN (
       SELECT owner_id, COUNT(*) AS count FROM leads WHERE is_deleted = false ${leadsDateCondition} GROUP BY owner_id
     ) received ON received.owner_id = u.id
     LEFT JOIN (
       SELECT owner_id, COUNT(*) AS count FROM leads
       WHERE is_deleted = false AND status = 'Converted' ${leadsDateCondition} GROUP BY owner_id
     ) converted ON converted.owner_id = u.id
     LEFT JOIN (
       SELECT created_by, COUNT(*) AS count FROM activities WHERE type = 'site_visit' ${visitsDateCondition} GROUP BY created_by
     ) visits ON visits.created_by = u.id
     WHERE u.role = 'agent' ${employeeCondition}
     ORDER BY u.name`,
    params
  );

  return result.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    leadsReceived: Number(row.leadsReceived),
    leadsConverted: Number(row.leadsConverted),
    conversionRate:
      Number(row.leadsReceived) === 0 ? 0 : Math.round((Number(row.leadsConverted) / Number(row.leadsReceived)) * 1000) / 10,
    siteVisitsLogged: Number(row.siteVisitsLogged),
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
