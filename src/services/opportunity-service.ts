import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { isLeadInOwnerScope, isLeadVisibleToUser } from "./lead-service";
import { createCustomerFromLead } from "./customer-service";
import { recordAuditEvent, listAuditLogForEntity } from "./audit-log-service";

// Reuses the same "subtree" idea as leads: an opportunity is visible to a
// user exactly when the lead it belongs to is visible to that user (Rule A
// hierarchy chain, or Rule B explicit share on the lead).
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

interface OpportunityRow {
  id: string;
  lead_id: string;
  name: string | null;
  value: string | null;
  stage: string;
  close_date: string | null;
  probability: string | null;
  contact_name: string | null;
  notes: string | null;
  won_at: string | null;
  is_deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityInput {
  name?: string;
  value?: number;
  stage?: string;
  closeDate?: string;
  probability?: number;
  contactName?: string;
  notes?: string;
}

export interface ListOpportunitiesFilters {
  stage?: string;
  leadId?: string;
  category?: string;
  ownerId?: string;
  zoneId?: string;
  territory?: string;
  salesTeamId?: string;
  search?: string;
  page: number;
  limit: number;
}

interface OpportunityListRow extends OpportunityRow {
  lead_full_name: string;
  lead_category: string | null;
  lead_store_city: string | null;
  lead_store_state: string | null;
  lead_zone_id: string | null;
  lead_territory: string | null;
  lead_sales_team_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  activity_count: string;
}

function toPublicOpportunity(row: OpportunityRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    value: row.value === null ? null : Number(row.value),
    stage: row.stage,
    closeDate: row.close_date,
    probability: row.probability === null ? null : Number(row.probability),
    contactName: row.contact_name,
    notes: row.notes,
    wonAt: row.won_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The Kanban board needs to show more than the raw opportunity row (the
// lead's name, category tag, city, and assigned salesperson) - a separate
// mapper rather than bloating every other call site with unused joins.
function toPublicOpportunityListItem(row: OpportunityListRow) {
  return {
    ...toPublicOpportunity(row),
    leadFullName: row.lead_full_name,
    leadCategory: row.lead_category,
    leadStoreCity: row.lead_store_city,
    leadStoreState: row.lead_store_state,
    leadZoneId: row.lead_zone_id,
    leadTerritory: row.lead_territory,
    leadSalesTeamId: row.lead_sales_team_id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    activityCount: Number(row.activity_count),
  };
}

export async function isOpportunityVisibleToUser(opportunityId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.id = $2
       AND o.is_deleted = false
       AND l.is_deleted = false
       AND (
         l.owner_id IN (SELECT id FROM subtree)
         OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
       )`,
    [userId, opportunityId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Narrower than isOpportunityVisibleToUser: true only when the underlying
// lead's owner is in the requesting user's subtree. Excludes lead_shares,
// mirroring isLeadInOwnerScope in lead-service.ts - an opportunity visible
// only because its lead was shared grants view access, not update/delete.
export async function isOpportunityInOwnerScope(opportunityId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     WHERE o.id = $2
       AND o.is_deleted = false
       AND l.is_deleted = false
       AND l.owner_id IN (SELECT id FROM subtree)`,
    [userId, opportunityId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Conversion mutates the source lead (status -> 'Converted', below) as well
// as creating the opportunity, so - like update/delete/share - it requires
// owner scope, not mere shared visibility. A lead shared with someone but
// not owned by them (or a subordinate of theirs) cannot be converted.
export async function convertLeadToOpportunity(leadId: string, input: OpportunityInput, requestingUserId: string) {
  const leadInScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!leadInScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Not guarded against an already-'Converted' lead - a lead can
    // legitimately pick up any number of opportunities over its lifetime
    // (see OpportunitiesTab's own "Opportunities from this lead" list, a
    // running total across all of them, with "+ New opportunity" always
    // available, never hidden after the first one). This UPDATE is
    // idempotent either way - setting status to 'Converted' again on a
    // lead that's already 'Converted' is a harmless no-op - it's kept here
    // (rather than dropped) only so it stays in the same transaction as
    // the opportunity INSERT below, for atomicity.
    // 'Converted' (capital C) matches pipeline_stages' real key for this
    // stage - the admin-editable source of truth the generic lead-status
    // dropdown also writes - not the lowercase 'converted' this used to
    // write, which silently diverged from it and from every lowercase-vs-
    // capitalized comparison below.
    await client.query("UPDATE leads SET status = 'Converted', updated_by = $1, updated_at = now() WHERE id = $2", [
      requestingUserId,
      leadId,
    ]);

    // Fetched inside the same transaction so it reflects the UPDATE above
    // (status) alongside the lead's other real fields - passed to
    // createCustomerFromLead after COMMIT, below, the same shape
    // lead-service.ts's updateLead already passes it.
    const leadResult = await client.query(
      `SELECT id, full_name, contact_name, phone, alt_phone, email, company_name, category, owner_id,
              store_city, zone_id, state_id, district_id, area_id, pincode, address_line1, address_line2,
              territory, credit_limit_requested
       FROM leads WHERE id = $1`,
      [leadId]
    );

    // A brand-new opportunity can start life already in 'won' (e.g. "+Add"
    // clicked directly in the Won column) - that's a transition into won too,
    // same as an update, so it gets the same won_at stamp.
    const result = await client.query<OpportunityRow>(
      `INSERT INTO opportunities (lead_id, name, value, stage, close_date, probability, contact_name, notes, created_by, updated_by, won_at)
       VALUES ($1, $2, $3, COALESCE($4, 'new'), $5, $6, $7, $8, $9, $9, CASE WHEN $4 = 'won' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        leadId,
        input.name ?? null,
        input.value ?? null,
        input.stage ?? null,
        input.closeDate ?? null,
        input.probability ?? null,
        input.contactName ?? null,
        input.notes ?? null,
        requestingUserId,
      ]
    );

    await client.query("COMMIT");

    // A customer is never created directly - this is the only place
    // convertLeadToOpportunity's own 'Converted' write can reach, since it's
    // a raw-SQL UPDATE that never passes through lead-service.ts's updateLead
    // (the other place this same auto-creation happens, for a direct status
    // edit). Idempotent (ON CONFLICT (lead_id) DO NOTHING inside
    // createCustomerFromLead) and caught, not rethrown: the opportunity
    // already committed above, so a failure here must not tell the caller
    // the conversion failed when it actually succeeded.
    try {
      await createCustomerFromLead(leadResult.rows[0]);
    } catch (err) {
      console.error(`Failed to auto-create customer for converted lead ${leadId}:`, err);
    }

    return toPublicOpportunity(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listOpportunitiesForLead(leadId: string, requestingUserId: string) {
  const leadVisible = await isLeadVisibleToUser(leadId, requestingUserId);
  if (!leadVisible) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const result = await pool.query<OpportunityRow>(
    "SELECT * FROM opportunities WHERE lead_id = $1 AND is_deleted = false ORDER BY created_at DESC",
    [leadId]
  );

  return result.rows.map(toPublicOpportunity);
}

export async function listOpportunitiesForUser(requestingUserId: string, filters: ListOpportunitiesFilters) {
  const conditions: string[] = ["o.is_deleted = false", "l.is_deleted = false"];
  const params: unknown[] = [requestingUserId];

  conditions.push(`(
    l.owner_id IN (SELECT id FROM subtree)
    OR EXISTS (SELECT 1 FROM lead_shares ls WHERE ls.lead_id = l.id AND ls.shared_with_user_id = $1)
  )`);

  if (filters.stage) {
    params.push(filters.stage);
    conditions.push(`o.stage = $${params.length}`);
  }
  if (filters.leadId) {
    params.push(filters.leadId);
    conditions.push(`o.lead_id = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`l.category = $${params.length}`);
  }
  if (filters.ownerId) {
    params.push(filters.ownerId);
    conditions.push(`l.owner_id = $${params.length}`);
  }
  if (filters.zoneId) {
    params.push(filters.zoneId);
    conditions.push(`l.zone_id = $${params.length}`);
  }
  if (filters.territory) {
    params.push(filters.territory);
    conditions.push(`l.territory = $${params.length}`);
  }
  if (filters.salesTeamId) {
    params.push(filters.salesTeamId);
    conditions.push(`l.sales_team_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(o.name ILIKE $${params.length} OR l.full_name ILIKE $${params.length})`);
  }

  const whereClause = conditions.join(" AND ");

  // Same WHERE/params as the main query, minus limit/offset - needed so the
  // mobile client (and any future web paging UI) can know the real total,
  // not just whether the current 200-row page happened to be full.
  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE} SELECT COUNT(*) FROM opportunities o JOIN leads l ON l.id = o.lead_id WHERE ${whereClause}`,
    params
  );

  const listParams = [...params, filters.limit, (filters.page - 1) * filters.limit];

  const result = await pool.query<OpportunityListRow>(
    `${SUBTREE_CTE}
     SELECT o.*, l.full_name AS lead_full_name, l.category AS lead_category,
       l.store_city AS lead_store_city, l.store_state AS lead_store_state,
       l.zone_id AS lead_zone_id, l.territory AS lead_territory, l.sales_team_id AS lead_sales_team_id,
       l.owner_id AS owner_id, u.name AS owner_name,
       (SELECT COUNT(*) FROM activities a WHERE a.opportunity_id = o.id) AS activity_count
     FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE ${whereClause}
     ORDER BY o.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return { opportunities: result.rows.map(toPublicOpportunityListItem), total: Number(countResult.rows[0].count) };
}

// Same joined shape listOpportunitiesForUser already returns (lead name,
// category, owner, ...) - not the bare row. Without this, an opportunity
// opened via a deep link (e.g. Global Search's "/opportunities?opportunityId=")
// came back with no leadFullName at all, even though every other entry
// point (clicking a Kanban card, already working off the list response)
// had it - the same data silently present or missing depending on how you
// got there.
export async function getOpportunityById(id: string, requestingUserId: string) {
  const visible = await isOpportunityVisibleToUser(id, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  const result = await pool.query<OpportunityListRow>(
    `SELECT o.*, l.full_name AS lead_full_name, l.category AS lead_category,
       l.store_city AS lead_store_city, l.store_state AS lead_store_state,
       l.zone_id AS lead_zone_id, l.territory AS lead_territory, l.sales_team_id AS lead_sales_team_id,
       l.owner_id AS owner_id, u.name AS owner_name,
       (SELECT COUNT(*) FROM activities a WHERE a.opportunity_id = o.id) AS activity_count
     FROM opportunities o
     JOIN leads l ON l.id = o.lead_id
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE o.id = $1 AND o.is_deleted = false`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Opportunity not found");
  }

  return toPublicOpportunityListItem(result.rows[0]);
}

export async function updateOpportunity(id: string, updates: OpportunityInput, requestingUserId: string) {
  const inScope = await isOpportunityInOwnerScope(id, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    value: updates.value,
    stage: updates.stage,
    close_date: updates.closeDate,
    probability: updates.probability,
    contact_name: updates.contactName,
    notes: updates.notes,
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
    return getOpportunityById(id, requestingUserId);
  }

  // Fetched once, before the UPDATE, whenever stage is changing - serves
  // both the won_at stamp below and the stage-change history entry after
  // the UPDATE commits. label prefers the opportunity's own name, falling
  // back to the lead's name exactly like the card/drawer display does, so
  // the history entry reads the same way the opportunity is shown anywhere
  // else in the UI.
  let before: { stage: string; label: string } | null = null;
  if (updates.stage !== undefined) {
    const current = await pool.query<{ stage: string; name: string | null; lead_full_name: string }>(
      `SELECT o.stage, o.name, l.full_name AS lead_full_name FROM opportunities o JOIN leads l ON l.id = o.lead_id WHERE o.id = $1`,
      [id]
    );
    const row = current.rows[0];
    before = row ? { stage: row.stage, label: row.name ?? row.lead_full_name } : null;
  }

  // Stamp won_at the moment stage actually transitions into 'won' - not on
  // every edit while it's already won (won_at is left alone), and not
  // touched at all when moving away from won (the historical value is
  // preserved, never cleared).
  if (updates.stage === "won" && before && before.stage !== "won") {
    setClauses.push("won_at = now()");
  }

  params.push(requestingUserId);
  setClauses.push(`updated_by = $${params.length}`);
  setClauses.push("updated_at = now()");

  params.push(id);

  const result = await pool.query<OpportunityRow>(
    `UPDATE opportunities SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );

  // A real, permanent log of every stage move - not just the updated_by/
  // updated_at pair above, which only ever remembers the single latest
  // change and gets silently overwritten the next time the deal moves.
  // Same pattern updateLead's own status_changed audit entry already uses.
  if (before && updates.stage !== undefined && updates.stage !== before.stage) {
    const actorResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]);
    await recordAuditEvent({
      entityType: "opportunity",
      entityId: id,
      entityLabel: before.label,
      action: "stage_changed",
      summary: `Stage changed - ${before.label}`,
      oldValue: before.stage,
      newValue: updates.stage,
      actorId: requestingUserId,
      actorName: actorResult.rows[0]?.name ?? null,
    });
  }

  return toPublicOpportunity(result.rows[0]);
}

// Powers the opportunity detail drawer's "History" section - every real
// stage move, newest first. Read-only, same visibility rule as viewing the
// opportunity itself (not owner-scope - anyone who can see this opportunity
// can see how it got here).
export async function listOpportunityHistory(id: string, requestingUserId: string) {
  const visible = await isOpportunityVisibleToUser(id, requestingUserId);
  if (!visible) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }
  return listAuditLogForEntity("opportunity", id);
}

export async function deleteOpportunity(id: string, requestingUserId: string): Promise<void> {
  const inScope = await isOpportunityInOwnerScope(id, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this opportunity");
  }

  await pool.query(
    "UPDATE opportunities SET is_deleted = true, updated_by = $1, updated_at = now() WHERE id = $2",
    [requestingUserId, id]
  );
}
