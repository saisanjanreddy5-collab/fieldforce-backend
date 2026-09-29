import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { recordAuditEvent } from "./audit-log-service";

interface AssignmentRuleRow {
  id: string;
  state_id: string | null;
  category: string | null;
  assigned_user_id: string;
  is_active: boolean;
  created_at: string;
  state_name: string | null;
  assigned_user_name: string;
}

// Real - this is the exact same table lead-service.ts's resolveAutoAssignee
// already reads from on every lead creation (state+category match, falling
// back to a category-less rule for that state). This is only new admin CRUD
// on top of it; no matching logic changes. Quotas, round-robin and a
// state-independent "fallback pool" from the reference don't exist in this
// engine - only state+category -> one fixed assignee.
function toPublicRule(row: AssignmentRuleRow) {
  return {
    id: row.id,
    stateId: row.state_id,
    stateName: row.state_name,
    category: row.category,
    assignedUserId: row.assigned_user_id,
    assignedUserName: row.assigned_user_name,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

const RULE_SELECT = `
  SELECT ar.*, s.name AS state_name, u.name AS assigned_user_name
  FROM assignment_rules ar
  LEFT JOIN states s ON s.id = ar.state_id
  JOIN users u ON u.id = ar.assigned_user_id
`;

export async function listAssignmentRules() {
  const result = await pool.query<AssignmentRuleRow>(`${RULE_SELECT} ORDER BY s.name ASC NULLS LAST, ar.category ASC NULLS LAST`);
  return result.rows.map(toPublicRule);
}

export interface CreateAssignmentRuleInput {
  stateId: string;
  category?: string;
  assignedUserId: string;
}

export async function createAssignmentRule(input: CreateAssignmentRuleInput) {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO assignment_rules (state_id, category, assigned_user_id) VALUES ($1,$2,$3) RETURNING id`,
    [input.stateId, input.category ?? null, input.assignedUserId]
  );
  const result = await pool.query<AssignmentRuleRow>(`${RULE_SELECT} WHERE ar.id = $1`, [inserted.rows[0].id]);
  return toPublicRule(result.rows[0]);
}

export interface UpdateAssignmentRuleInput {
  category?: string | null;
  assignedUserId?: string;
  isActive?: boolean;
}

export async function updateAssignmentRule(
  id: string,
  updates: UpdateAssignmentRuleInput,
  requestingUserId?: string,
  ipAddress?: string | null
) {
  const beforeResult = await pool.query<AssignmentRuleRow>(`${RULE_SELECT} WHERE ar.id = $1`, [id]);
  const before = beforeResult.rows[0];

  const fieldMap: Record<string, unknown> = {
    category: updates.category,
    assigned_user_id: updates.assignedUserId,
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

  if (setClauses.length > 0) {
    params.push(id);
    const updateResult = await pool.query(`UPDATE assignment_rules SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);
    if ((updateResult.rowCount ?? 0) === 0) {
      throw new ApiError(404, "Assignment rule not found");
    }
  }

  const result = await pool.query<AssignmentRuleRow>(`${RULE_SELECT} WHERE ar.id = $1`, [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Assignment rule not found");
  }
  const after = result.rows[0];

  if (before && requestingUserId) {
    const ruleLabel = `${before.state_name ?? "All states"}${before.category ? ` - ${before.category}` : ""}`;
    if (before.assigned_user_id !== after.assigned_user_id) {
      const actorResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]);
      await recordAuditEvent({
        entityType: "assignment_rule",
        entityId: id,
        entityLabel: ruleLabel,
        action: "assignment_rule_edited",
        summary: `Assignment rule edited - ${ruleLabel}`,
        oldValue: before.assigned_user_name,
        newValue: after.assigned_user_name,
        actorId: requestingUserId,
        actorName: actorResult.rows[0]?.name ?? null,
        ipAddress,
      });
    } else if (before.is_active !== after.is_active) {
      const actorResult = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]);
      await recordAuditEvent({
        entityType: "assignment_rule",
        entityId: id,
        entityLabel: ruleLabel,
        action: "assignment_rule_edited",
        summary: `Assignment rule edited - ${ruleLabel}`,
        oldValue: before.is_active ? "Active" : "Inactive",
        newValue: after.is_active ? "Active" : "Inactive",
        actorId: requestingUserId,
        actorName: actorResult.rows[0]?.name ?? null,
        ipAddress,
      });
    }
  }

  return toPublicRule(after);
}
