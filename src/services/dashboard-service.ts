import { pool } from "../config/db";

// Every metric here is scoped to the requesting user's subtree (themselves +
// everyone below them in the reporting chain) - the same Rule A idea used
// everywhere else. An individual agent's subtree is just themselves, so they
// see personal numbers; a manager's subtree includes their whole team, so
// the same queries naturally roll up into team-wide numbers.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

export async function getOverview(requestingUserId: string) {
  const [totalLeadsResult, totalOpportunitiesResult, pipelineValueResult, conversionResult, activeResult] =
    await Promise.all([
      pool.query<{ count: string }>(
        `${SUBTREE_CTE}
         SELECT COUNT(*) FROM leads l
         WHERE l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)`,
        [requestingUserId]
      ),
      pool.query<{ count: string }>(
        `${SUBTREE_CTE}
         SELECT COUNT(*) FROM opportunities o
         JOIN leads l ON l.id = o.lead_id
         WHERE o.is_deleted = false AND l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)`,
        [requestingUserId]
      ),
      pool.query<{ total: string | null }>(
        `${SUBTREE_CTE}
         SELECT SUM(o.value) AS total FROM opportunities o
         JOIN leads l ON l.id = o.lead_id
         WHERE o.is_deleted = false AND l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)`,
        [requestingUserId]
      ),
      pool.query<{ converted: string; created: string }>(
        `${SUBTREE_CTE}
         SELECT
           COUNT(*) FILTER (WHERE l.status = 'converted' AND l.updated_at >= now() - interval '30 days') AS converted,
           COUNT(*) FILTER (WHERE l.created_at >= now() - interval '30 days') AS created
         FROM leads l
         WHERE l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)`,
        [requestingUserId]
      ),
      pool.query<{ count: string }>(
        `${SUBTREE_CTE}
         SELECT COUNT(DISTINCT a.user_id) FROM attendance a
         WHERE a.status = 'checked_in' AND a.user_id IN (SELECT id FROM subtree)`,
        [requestingUserId]
      ),
    ]);

  const created = Number(conversionResult.rows[0].created);
  const converted = Number(conversionResult.rows[0].converted);

  return {
    totalLeads: Number(totalLeadsResult.rows[0].count),
    totalOpportunities: Number(totalOpportunitiesResult.rows[0].count),
    pipelineValue: Number(pipelineValueResult.rows[0].total ?? 0),
    conversionRate30d: created === 0 ? 0 : Math.round((converted / created) * 1000) / 10,
    activeTeamMembersCount: Number(activeResult.rows[0].count),
  };
}

export async function getPipelineByStage(requestingUserId: string) {
  const result = await pool.query<{ stage: string; count: string; total_value: string | null }>(
    `${SUBTREE_CTE}
     SELECT o.stage, COUNT(*) AS count, SUM(o.value) AS total_value
     FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.is_deleted = false AND l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)
     GROUP BY o.stage
     ORDER BY o.stage`,
    [requestingUserId]
  );

  return result.rows.map((row) => ({
    stage: row.stage,
    count: Number(row.count),
    totalValue: Number(row.total_value ?? 0),
  }));
}

export async function getLeadsByStatus(requestingUserId: string) {
  const result = await pool.query<{ status: string; count: string }>(
    `${SUBTREE_CTE}
     SELECT l.status, COUNT(*) AS count
     FROM leads l
     WHERE l.is_deleted = false AND l.owner_id IN (SELECT id FROM subtree)
     GROUP BY l.status
     ORDER BY l.status`,
    [requestingUserId]
  );

  return result.rows.map((row) => ({ status: row.status, count: Number(row.count) }));
}

export async function getTeamPerformance(requestingUserId: string) {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       u.id AS "userId",
       u.name,
       COALESCE(lead_counts.count, 0) AS "leadsOwned",
       COALESCE(opp_counts.count, 0) AS "opportunitiesOwned",
       COALESCE(activity_counts.count, 0) AS "activitiesLogged",
       COALESCE(converted_counts.count, 0) AS "leadsConverted"
     FROM subtree s
     JOIN users u ON u.id = s.id
     LEFT JOIN (
       SELECT owner_id, COUNT(*) AS count FROM leads WHERE is_deleted = false GROUP BY owner_id
     ) lead_counts ON lead_counts.owner_id = u.id
     LEFT JOIN (
       SELECT owner_id, COUNT(*) AS count FROM leads WHERE is_deleted = false AND status = 'converted' GROUP BY owner_id
     ) converted_counts ON converted_counts.owner_id = u.id
     LEFT JOIN (
       SELECT l.owner_id, COUNT(*) AS count
       FROM opportunities o
       JOIN leads l ON l.id = o.lead_id
       WHERE o.is_deleted = false
       GROUP BY l.owner_id
     ) opp_counts ON opp_counts.owner_id = u.id
     LEFT JOIN (
       SELECT created_by, COUNT(*) AS count FROM activities GROUP BY created_by
     ) activity_counts ON activity_counts.created_by = u.id
     ORDER BY u.name`,
    [requestingUserId]
  );

  return result.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    leadsOwned: Number(row.leadsOwned),
    opportunitiesOwned: Number(row.opportunitiesOwned),
    activitiesLogged: Number(row.activitiesLogged),
    leadsConverted: Number(row.leadsConverted),
    conversionRate: Number(row.leadsOwned) === 0 ? 0 : Math.round((Number(row.leadsConverted) / Number(row.leadsOwned)) * 1000) / 10,
  }));
}

export interface VisitHistoryFilters {
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export async function getVisitHistory(requestingUserId: string, filters: VisitHistoryFilters) {
  const conditions: string[] = ["a.type = 'site_visit'", "l.is_deleted = false", "l.owner_id IN (SELECT id FROM subtree)"];
  const params: unknown[] = [requestingUserId];

  if (filters.from) {
    params.push(filters.from);
    conditions.push(`a.created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`a.created_at <= $${params.length}`);
  }

  params.push(filters.limit, (filters.page - 1) * filters.limit);

  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       a.id, a.subject, a.status, a.details, a.created_at AS "createdAt",
       l.id AS "leadId", l.full_name AS "leadName", l.company_name AS "companyName",
       u.id AS "userId", u.name AS "userName"
     FROM activities a
     JOIN leads l ON l.id = a.lead_id
     LEFT JOIN users u ON u.id = a.created_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows;
}
