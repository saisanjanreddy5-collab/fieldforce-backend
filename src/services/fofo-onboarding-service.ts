import crypto from "crypto";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import * as leadService from "./lead-service";
import * as leadDocumentService from "./lead-document-service";

const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// A deal size above which the reference's "Regional Head (value > ₹15L)"
// condition actually applies - real, not cosmetic: below this, the third
// approval step is auto-marked not_applicable instead of waiting forever.
const HIGH_VALUE_THRESHOLD = 1_500_000;

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
// only when the lead's real expected_value clears HIGH_VALUE_THRESHOLD.
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
    const isHighValue = expectedValue !== null && expectedValue > HIGH_VALUE_THRESHOLD;
    steps.push({
      order: 3,
      role: "Regional head approval",
      approverId: chain[chain.length - 1],
      status: isHighValue ? "pending" : "not_applicable",
      note: `Required only when expected value exceeds ₹${(HIGH_VALUE_THRESHOLD / 100000).toFixed(0)}L`,
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

export async function decideStep(stepId: string, decision: "approved" | "rejected", requestingUserId: string, requestingRole: string) {
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

  await pool.query(
    "UPDATE lead_approval_steps SET status = $1, decided_by = $2, decided_at = now() WHERE id = $3",
    [decision, requestingUserId, stepId]
  );
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
  l.push_status AS "pushStatus", l.expected_value AS "expectedValue", u.name AS "ownerName"
`;

// Deliberately no admin bypass here, even though other list endpoints in
// this app special-case admin - leads visibility (getHandoff and
// pushToOnboardingApp both go through lead-service's isLeadVisibleToUser/
// isLeadInOwnerScope) has no admin bypass anywhere in FieldForce; admin
// sees everyone only because the real org chart happens to roll up to the
// one real admin account. Bypassing it here would show admin leads in the
// list that getHandoff then refuses to open.
export async function listFofoOnboardings(requestingUserId: string) {
  const result = await pool.query<{ expectedValue: string | null } & Record<string, unknown>>(
    `${SUBTREE_CTE}
     SELECT ${LIST_COLUMNS}
     FROM leads l LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.is_deleted = false AND l.category = 'FOFO' AND l.owner_id IN (SELECT id FROM subtree)
     ORDER BY l.created_at DESC`,
    [requestingUserId]
  );
  // pg returns DECIMAL columns as strings - convert here, same as
  // lead-service's toPublicLead does for every other money column.
  return result.rows.map((row) => ({ ...row, expectedValue: row.expectedValue === null ? null : Number(row.expectedValue) }));
}
