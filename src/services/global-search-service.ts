import { pool } from "../config/db";

// Same subtree-visibility rule leads/opportunities already use everywhere
// else (owner in the requester's reporting subtree, or explicitly shared) -
// global search never shows a record the Leads/Opportunities pages
// themselves wouldn't show this same user.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

const VISIBILITY_CLAUSE = `(
  l.owner_id IN (SELECT id FROM subtree)
  OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
)`;

interface LeadResultRow {
  id: string;
  full_name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  status: string;
}

interface OpportunityResultRow {
  id: string;
  name: string | null;
  lead_full_name: string;
  stage: string;
  value: string | null;
}

export interface SearchLeadResult {
  id: string;
  fullName: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  status: string;
}

export interface SearchOpportunityResult {
  id: string;
  name: string;
  leadFullName: string;
  stage: string;
  value: number | null;
}

const RESULT_LIMIT = 6;

export async function globalSearch(requestingUserId: string, query: string): Promise<{ leads: SearchLeadResult[]; opportunities: SearchOpportunityResult[] }> {
  const term = `%${query}%`;

  const leadsResult = await pool.query<LeadResultRow>(
    `${SUBTREE_CTE}
     SELECT l.id, l.full_name, l.company_name, l.phone, l.email, l.category, l.status
     FROM leads l
     WHERE l.is_deleted = false AND ${VISIBILITY_CLAUSE}
       AND (l.full_name ILIKE $2 OR l.company_name ILIKE $2 OR l.phone ILIKE $2 OR l.email ILIKE $2 OR l.contact_name ILIKE $2)
     ORDER BY l.created_at DESC
     LIMIT ${RESULT_LIMIT}`,
    [requestingUserId, term]
  );

  const opportunitiesResult = await pool.query<OpportunityResultRow>(
    `${SUBTREE_CTE}
     SELECT o.id, o.name, l.full_name AS lead_full_name, o.stage, o.value
     FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.is_deleted = false AND l.is_deleted = false AND ${VISIBILITY_CLAUSE}
       AND (o.name ILIKE $2 OR l.full_name ILIKE $2)
     ORDER BY o.created_at DESC
     LIMIT ${RESULT_LIMIT}`,
    [requestingUserId, term]
  );

  return {
    leads: leadsResult.rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      companyName: r.company_name,
      phone: r.phone,
      email: r.email,
      category: r.category,
      status: r.status,
    })),
    opportunities: opportunitiesResult.rows.map((r) => ({
      id: r.id,
      name: r.name ?? r.lead_full_name,
      leadFullName: r.lead_full_name,
      stage: r.stage,
      value: r.value === null ? null : Number(r.value),
    })),
  };
}
