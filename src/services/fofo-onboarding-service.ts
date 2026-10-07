import crypto from "crypto";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import * as leadService from "./lead-service";
import * as leadDocumentService from "./lead-document-service";
import { getNumericSetting } from "./app-settings-service";
import { recordAuditEvent } from "./audit-log-service";

const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// A deal size above which the "Regional Head" condition actually applies -
// real, not cosmetic: below this, the third approval step is auto-marked
// not_applicable instead of waiting forever. Was a hardcoded constant;
// Settings > Approvals now edits this same app_settings row for real, so a
// policy change here takes effect on the next lead without a redeploy.
const DEFAULT_HIGH_VALUE_THRESHOLD = 1_500_000;

async function getHighValueThreshold(): Promise<number> {
  return getNumericSetting("high_value_deal_threshold", DEFAULT_HIGH_VALUE_THRESHOLD);
}

interface ApprovalStepRow {
  id: string;
  lead_id: string;
  step_order: number;
  role_label: string;
  approver_user_id: string | null;
  status: "pending" | "approved" | "rejected" | "not_applicable";
  condition_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

function toPublicStep(row: ApprovalStepRow, approverName: string | null, isCurrentTurn: boolean) {
  return {
    id: row.id,
    leadId: row.lead_id,
    stepOrder: row.step_order,
    roleLabel: row.role_label,
    approverUserId: row.approver_user_id,
    approverName,
    status: row.status,
    conditionNote: row.condition_note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    isCurrentTurn,
  };
}

// Named approvers are derived from the real manager_id chain above the
// lead's owner - never a fabricated "Ops" role, since FieldForce has no
// such role. Step 1 = owner's direct manager, step 2 = their manager
// (skip-level), step 3 = the topmost person in that same line, required
// only when the lead's real expected_value clears the configured threshold.
async function deriveApprovalChain(leadId: string, ownerId: string, expectedValue: number | null): Promise<void> {
  const existing = await pool.query("SELECT 1 FROM lead_approval_steps WHERE lead_id = $1 LIMIT 1", [leadId]);
  if ((existing.rowCount ?? 0) > 0) return;

  const chainResult = await pool.query<{ id: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, manager_id, 0 AS depth FROM users WHERE id = $1
       UNION ALL
       SELECT u.id, u.manager_id, c.depth + 1
       FROM users u INNER JOIN chain c ON u.id = c.manager_id
     )
     SELECT id FROM chain WHERE depth > 0 ORDER BY depth ASC`,
    [ownerId]
  );
  const chain = chainResult.rows.map((r) => r.id);

  const steps: { order: number; role: string; approverId: string; status: string; note: string | null }[] = [];
  if (chain.length >= 1) {
    steps.push({ order: 1, role: "Reporting manager approval", approverId: chain[0], status: "pending", note: null });
  }
  if (chain.length >= 2) {
    steps.push({ order: 2, role: "Senior approval", approverId: chain[1], status: "pending", note: null });
  }
  if (chain.length >= 3 && chain[chain.length - 1] !== chain[1]) {
    const threshold = await getHighValueThreshold();
    const isHighValue = expectedValue !== null && expectedValue > threshold;
    steps.push({
      order: 3,
      role: "Regional head approval",
      approverId: chain[chain.length - 1],
      status: isHighValue ? "pending" : "not_applicable",
      note: `Required only when expected value exceeds ₹${(threshold / 100000).toFixed(0)}L`,
    });
  }

  for (const step of steps) {
    await pool.query(
      `INSERT INTO lead_approval_steps (lead_id, step_order, role_label, approver_user_id, status, condition_note)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lead_id, step_order) DO NOTHING`,
      [leadId, step.order, step.role, step.approverId, step.status, step.note]
    );
  }
}

export async function listApprovalSteps(leadId: string, ownerId: string, expectedValue: number | null) {
  await deriveApprovalChain(leadId, ownerId, expectedValue);

  const result = await pool.query<ApprovalStepRow & { approver_name: string | null }>(
    `SELECT s.*, u.name AS approver_name FROM lead_approval_steps s
     LEFT JOIN users u ON u.id = s.approver_user_id
     WHERE s.lead_id = $1 ORDER BY s.step_order ASC`,
    [leadId]
  );

  // A step is "waiting" (not yet its turn) rather than genuinely "pending"
  // until every earlier step has resolved - matches the reference's visual
  // distinction between an active Pending step and later Waiting ones.
  // approved/not_applicable count as resolved; a rejection kills the whole
  // chain (matches decideStep/pushToOnboardingApp), so nothing after it is
  // ever a current turn.
  let priorResolved = true;
  let chainRejected = false;
  return result.rows.map((row) => {
    if (row.status === "rejected") chainRejected = true;
    const isCurrentTurn = row.status === "pending" && priorResolved && !chainRejected;
    if (row.status === "pending") {
      priorResolved = false;
    }
    return toPublicStep(row, row.approver_name, isCurrentTurn);
  });
}

export async function decideStep(
  stepId: string,
  decision: "approved" | "rejected",
  requestingUserId: string,
  requestingRole: string,
  ipAddress?: string | null
) {
  const stepResult = await pool.query<ApprovalStepRow>("SELECT * FROM lead_approval_steps WHERE id = $1", [stepId]);
  if (stepResult.rows.length === 0) {
    throw new ApiError(404, "Approval step not found");
  }
  const step = stepResult.rows[0];

  if (requestingRole !== "admin" && step.approver_user_id !== requestingUserId) {
    throw new ApiError(403, "Only the assigned approver can decide this step");
  }
  if (step.status !== "pending") {
    throw new ApiError(422, "This step has already been decided");
  }

  // A rejection anywhere kills the whole chain - matches pushToOnboardingApp,
  // which already blocks on any rejected step regardless of position. Without
  // this, a later step could still be approved after an earlier rejection,
  // leaving a confusing "partially approved but overall rejected" handoff.
  const anyRejected = await pool.query("SELECT 1 FROM lead_approval_steps WHERE lead_id = $1 AND status = 'rejected' LIMIT 1", [
    step.lead_id,
  ]);
  if ((anyRejected.rowCount ?? 0) > 0) {
    throw new ApiError(422, "This handoff already has a rejected step - no further steps can be decided");
  }

  const priorPending = await pool.query(
    "SELECT 1 FROM lead_approval_steps WHERE lead_id = $1 AND step_order < $2 AND status = 'pending' LIMIT 1",
    [step.lead_id, step.step_order]
  );
  if ((priorPending.rowCount ?? 0) > 0) {
    throw new ApiError(422, "Earlier approval steps must be resolved first");
  }

  // Guarded by "AND status = 'pending'" (not just the pre-read above) so a
  // concurrent/duplicate decision on the same step can't silently overwrite
  // this one - the loser's UPDATE affects zero rows and surfaces a conflict.
  const decided = await pool.query(
    "UPDATE lead_approval_steps SET status = $1, decided_by = $2, decided_at = now() WHERE id = $3 AND status = 'pending'",
    [decision, requestingUserId, stepId]
  );
  if (decided.rowCount === 0) {
    throw new ApiError(422, "This step has already been decided");
  }

  const [leadResult, actorResult] = await Promise.all([
    pool.query<{ full_name: string; store_name: string | null }>("SELECT full_name, store_name FROM leads WHERE id = $1", [step.lead_id]),
    pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]),
  ]);
  const leadLabel = leadResult.rows[0]?.store_name ?? leadResult.rows[0]?.full_name ?? "Unknown lead";
  await recordAuditEvent({
    entityType: "fofo_approval_step",
    entityId: stepId,
    entityLabel: leadLabel,
    action: "approval_decided",
    summary: `Approval ${decision} - ${leadLabel}`,
    oldValue: "Pending",
    newValue: decision === "approved" ? "Approved" : "Rejected",
    actorId: requestingUserId,
    actorName: actorResult.rows[0]?.name ?? null,
    ipAddress,
  });

  return step.lead_id;
}

export async function getHandoff(leadId: string, requestingUserId: string) {
  const lead = await leadService.getLeadById(leadId, requestingUserId);
  const steps = await listApprovalSteps(leadId, lead.ownerId!, lead.expectedValue);
  const documents = await leadDocumentService.listDocuments(leadId);
  return { lead, approvalSteps: steps, documents };
}

// Real internal action, clearly not a call to any external system - no
// onboarding app exists to push to. Validates every approval step is
// resolved (approved or not_applicable), then records a real timestamp and
// a generated reference code so the "pushed" state is genuine, persisted
// data rather than a UI-only toggle.
export async function pushToOnboardingApp(leadId: string, requestingUserId: string) {
  const inScope = await leadService.isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const steps = await pool.query<ApprovalStepRow>("SELECT * FROM lead_approval_steps WHERE lead_id = $1", [leadId]);
  if (steps.rows.some((s) => s.status === "rejected")) {
    throw new ApiError(422, "This handoff has a rejected approval step and cannot be pushed");
  }
  if (steps.rows.some((s) => s.status === "pending")) {
    throw new ApiError(422, "All approval steps must be approved before pushing");
  }

  const onboardingAppId = `FOFO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await pool.query(
    "UPDATE leads SET push_status = 'pushed', onboarding_app_id = $1, pushed_at = now(), updated_at = now() WHERE id = $2",
    [onboardingAppId, leadId]
  );

  return getHandoff(leadId, requestingUserId);
}

const LIST_COLUMNS = `
  l.id, l.lead_number AS "leadNumber", l.full_name AS "fullName", l.store_name AS "storeName",
  l.store_city AS "storeCity", l.store_state AS "storeState", l.status,
  l.push_status AS "pushStatus", l.expected_value AS "expectedValue", u.name AS "ownerName",
  l.created_at AS "createdAt"
`;

// Deliberately no admin bypass here. lead-service.ts's isLeadVisibleToUser/
// isLeadInOwnerScope (which getHandoff and pushToOnboardingApp both go
// through) do now carry one narrow, deliberate admin exception - unassigned
// leads (owner_id IS NULL), which are otherwise unreachable for anyone.
// That doesn't apply here: a FOFO handoff only exists for leads with a real
// owner (deriveApprovalChain needs an owner to walk the manager chain
// from), so it isn't relevant to this list. Beyond that one case, admin
// still sees everyone else's leads only because the real org chart happens
// to roll up to the one real admin account - this file adds no broader
// bypass, since that would show admin leads in the list that getHandoff
// then refuses to open.
export async function listFofoOnboardings(requestingUserId: string, page: number, limit: number) {
  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE}
     SELECT COUNT(*) FROM leads l
     WHERE l.is_deleted = false AND l.category = 'FOFO' AND l.owner_id IN (SELECT id FROM subtree)`,
    [requestingUserId]
  );

  const offset = (page - 1) * limit;
  const result = await pool.query<{ expectedValue: string | null } & Record<string, unknown>>(
    `${SUBTREE_CTE}
     SELECT ${LIST_COLUMNS}
     FROM leads l LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.is_deleted = false AND l.category = 'FOFO' AND l.owner_id IN (SELECT id FROM subtree)
     ORDER BY l.created_at DESC
     LIMIT $2 OFFSET $3`,
    [requestingUserId, limit, offset]
  );
  // pg returns DECIMAL columns as strings - convert here, same as
  // lead-service's toPublicLead does for every other money column.
  return {
    leads: result.rows.map((row) => ({ ...row, expectedValue: row.expectedValue === null ? null : Number(row.expectedValue) })),
    total: Number(countResult.rows[0].count),
  };
}

interface PendingStepRow {
  step_id: string;
  lead_id: string;
  lead_number: number | null;
  full_name: string;
  store_name: string | null;
  store_city: string | null;
  owner_name: string | null;
  expected_value: string | null;
  step_order: number;
  role_label: string;
  condition_note: string | null;
  created_at: string;
}

// For the Approvals inbox - "pending on me right now" across every FOFO
// handoff, not scoped to one lead. A step only counts when it's genuinely
// this approver's current turn: the same two conditions listApprovalSteps's
// isCurrentTurn and decideStep both already enforce (nothing earlier in the
// same lead's chain still pending, nothing in that chain already rejected).
export async function listPendingApprovalStepsForUser(userId: string) {
  const result = await pool.query<PendingStepRow>(
    `SELECT s.id AS step_id, s.lead_id, l.lead_number, l.full_name, l.store_name, l.store_city,
       u.name AS owner_name, l.expected_value, s.step_order, s.role_label, s.condition_note, s.created_at
     FROM lead_approval_steps s
     JOIN leads l ON l.id = s.lead_id
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE s.approver_user_id = $1 AND s.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM lead_approval_steps s2 WHERE s2.lead_id = s.lead_id AND s2.status = 'rejected')
       AND NOT EXISTS (SELECT 1 FROM lead_approval_steps s2 WHERE s2.lead_id = s.lead_id AND s2.step_order < s.step_order AND s2.status = 'pending')
     ORDER BY s.created_at ASC`,
    [userId]
  );
  return result.rows.map((row) => ({
    stepId: row.step_id,
    leadId: row.lead_id,
    leadNumber: row.lead_number,
    fullName: row.full_name,
    storeName: row.store_name,
    storeCity: row.store_city,
    ownerName: row.owner_name,
    expectedValue: row.expected_value === null ? null : Number(row.expected_value),
    stepOrder: row.step_order,
    roleLabel: row.role_label,
    conditionNote: row.condition_note,
    createdAt: row.created_at,
  }));
}

// For the Approvals inbox's "approved this week" stat - see leave-service's
// listDecidedThisWeek, same shape (this one has no second-tier distinction,
// just decided_by directly).
export async function listDecidedStepsThisWeek(userId: string) {
  const result = await pool.query<{ created_at: string; decided_at: string }>(
    `SELECT created_at, decided_at FROM lead_approval_steps
     WHERE decided_by = $1 AND decided_at IS NOT NULL AND decided_at > now() - interval '7 days'
       AND status IN ('approved', 'rejected')`,
    [userId]
  );
  return result.rows;
}
