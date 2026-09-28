import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

export const EXPENSE_TYPE_KEYS = [
  "travel",
  "fuel",
  "lodging",
  "meals",
  "client_entertainment",
  "telecom",
  "marketing_collateral",
] as const;
export type ExpenseTypeKey = (typeof EXPENSE_TYPE_KEYS)[number];

// travel/client_entertainment/telecom/marketing_collateral are a flat cap
// per claim - fuel/lodging/meals scale with the "distance / nights / count"
// quantity field instead (₹/km, ₹/night, ₹/day).
const PER_UNIT_KINDS: readonly string[] = ["fuel", "lodging", "meals"];

interface ExpenseTypeRow {
  id: string;
  key: ExpenseTypeKey;
  label: string;
  color: string;
  limit_amount: string;
  limit_unit: string;
  metro_limit_amount: string | null;
  receipt_required: boolean;
  requires_linked_opportunity: boolean;
  policy_note: string;
  sort_order: number;
}

interface ExpenseClaimRow {
  id: string;
  claim_number: number;
  user_id: string;
  expense_type_key: ExpenseTypeKey;
  title: string;
  expense_date: string;
  amount: string;
  quantity: string | null;
  linked_lead_id: string | null;
  linked_opportunity_id: string | null;
  receipt_file_path: string | null;
  receipt_original_filename: string | null;
  is_policy_breach: boolean;
  policy_limit_at_submission: string | null;
  status: "pending" | "approved" | "rejected" | "paid";
  approver_id: string | null;
  approver_decision: "approved" | "rejected" | null;
  approver_decided_at: string | null;
  second_approver_id: string | null;
  second_approver_decision: "approved" | "rejected" | null;
  second_approver_decided_at: string | null;
  decision_note: string | null;
  paid_by: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  approver_name?: string | null;
  second_approver_name?: string | null;
  lead_full_name?: string | null;
  lead_number?: number | null;
  opportunity_name?: string | null;
}

export interface CreateExpenseClaimInput {
  expenseTypeKey: ExpenseTypeKey;
  title: string;
  expenseDate: string;
  amount: number;
  quantity?: number;
  linkedLeadId?: string;
  linkedOpportunityId?: string;
}

function toPublicExpenseType(row: ExpenseTypeRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    color: row.color,
    limitAmount: Number(row.limit_amount),
    limitUnit: row.limit_unit,
    metroLimitAmount: row.metro_limit_amount === null ? null : Number(row.metro_limit_amount),
    receiptRequired: row.receipt_required,
    requiresLinkedOpportunity: row.requires_linked_opportunity,
    policyNote: row.policy_note,
  };
}

function toPublicExpenseClaim(row: ExpenseClaimRow) {
  return {
    id: row.id,
    claimNumber: row.claim_number,
    userId: row.user_id,
    userName: row.user_name ?? null,
    expenseTypeKey: row.expense_type_key,
    title: row.title,
    expenseDate: row.expense_date,
    amount: Number(row.amount),
    quantity: row.quantity === null ? null : Number(row.quantity),
    linkedLeadId: row.linked_lead_id,
    linkedLeadLabel: row.lead_number ? `LEAD-${row.lead_number} ${row.lead_full_name ?? ""}`.trim() : null,
    linkedOpportunityId: row.linked_opportunity_id,
    linkedOpportunityLabel: row.opportunity_name ?? null,
    hasReceipt: row.receipt_file_path !== null,
    isPolicyBreach: row.is_policy_breach,
    policyLimitAtSubmission: row.policy_limit_at_submission === null ? null : Number(row.policy_limit_at_submission),
    status: row.status,
    approverId: row.approver_id,
    approverName: row.approver_name ?? null,
    approverDecision: row.approver_decision,
    approverDecidedAt: row.approver_decided_at,
    secondApproverId: row.second_approver_id,
    secondApproverName: row.second_approver_name ?? null,
    secondApproverDecision: row.second_approver_decision,
    secondApproverDecidedAt: row.second_approver_decided_at,
    decisionNote: row.decision_note,
    paidBy: row.paid_by,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

export async function listExpenseTypes() {
  const result = await pool.query<ExpenseTypeRow>("SELECT * FROM expense_types ORDER BY sort_order ASC");
  return result.rows.map(toPublicExpenseType);
}

async function getExpenseTypeByKey(key: ExpenseTypeKey): Promise<ExpenseTypeRow> {
  const result = await pool.query<ExpenseTypeRow>("SELECT * FROM expense_types WHERE key = $1", [key]);
  if (result.rows.length === 0) {
    throw new ApiError(500, `Expense type '${key}' is not configured`);
  }
  return result.rows[0];
}

async function getDirectManagerId(userId: string): Promise<string | null> {
  const result = await pool.query<{ manager_id: string | null }>("SELECT manager_id FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.manager_id ?? null;
}

// Walks the manager chain upward from startUserId looking for the first
// ancestor whose level is at least as senior as targetSortOrder (lower
// sort_order = more senior, same convention the org ladder/L1..L6 numbering
// uses everywhere else). Returns the most senior ancestor found even if
// none is senior enough, so escalation degrades to "whoever is highest up"
// rather than silently finding nobody in a shallow org.
async function findAncestorAtOrAboveLevel(startUserId: string, targetSortOrder: number): Promise<string | null> {
  let currentId = startUserId;
  let lastAncestor: string | null = null;
  for (let hops = 0; hops < 20; hops++) {
    const result = await pool.query<{ manager_id: string | null }>("SELECT manager_id FROM users WHERE id = $1", [currentId]);
    const managerId = result.rows[0]?.manager_id ?? null;
    if (!managerId) break;
    lastAncestor = managerId;
    const levelResult = await pool.query<{ sort_order: number | null }>(
      "SELECT l.sort_order FROM users u JOIN levels l ON l.id = u.level_id WHERE u.id = $1",
      [managerId]
    );
    const sortOrder = levelResult.rows[0]?.sort_order;
    if (sortOrder !== undefined && sortOrder !== null && sortOrder <= targetSortOrder) {
      return managerId;
    }
    currentId = managerId;
  }
  return lastAncestor;
}

// Reads the real, admin-configured escalation ladder (Sales Force
// Management's Approval bands screen, request_type='expense_claim') instead
// of a hardcoded rule - if nothing is configured there (the default, empty
// state), every claim just goes to the direct manager, exactly matching
// the reference's own examples. Only escalates beyond the direct manager
// when a matching band actually asks for someone more senior.
async function resolveSecondApprover(requesterId: string, directManagerId: string, amount: number): Promise<string | null> {
  const bandResult = await pool.query<{ approver_level_id: string | null; countersigned_by_level_id: string | null }>(
    `SELECT approver_level_id, countersigned_by_level_id FROM approval_bands
     WHERE request_type = 'expense_claim' AND range_from <= $1 AND (range_to IS NULL OR range_to >= $1)
     ORDER BY sort_order ASC LIMIT 1`,
    [amount]
  );
  const band = bandResult.rows[0];
  if (!band) return null;

  const targetLevelId = band.countersigned_by_level_id ?? band.approver_level_id;
  if (!targetLevelId) return null;

  const targetLevelResult = await pool.query<{ sort_order: number }>("SELECT sort_order FROM levels WHERE id = $1", [targetLevelId]);
  const targetSortOrder = targetLevelResult.rows[0]?.sort_order;
  if (targetSortOrder === undefined) return null;

  const directManagerLevelResult = await pool.query<{ sort_order: number | null }>(
    "SELECT l.sort_order FROM users u JOIN levels l ON l.id = u.level_id WHERE u.id = $1",
    [directManagerId]
  );
  const directManagerSortOrder = directManagerLevelResult.rows[0]?.sort_order;
  // The band doesn't actually ask for anyone more senior than the direct
  // manager already is - no second approver needed.
  if (directManagerSortOrder !== null && directManagerSortOrder !== undefined && directManagerSortOrder <= targetSortOrder) {
    return null;
  }

  const resolved = await findAncestorAtOrAboveLevel(requesterId, targetSortOrder);
  return resolved !== directManagerId ? resolved : null;
}

// Lodging is the one type with a second, more generous cap
// (metro_limit_amount) - there's no city-tier field anywhere on a claim to
// key off automatically, so rather than always enforcing the stricter base
// rate (which would misflag legitimate metro-city stays as a breach), the
// more generous figure is used whenever one is configured.
function effectiveLimit(type: ExpenseTypeRow, quantity: number | undefined): number {
  const base = type.metro_limit_amount !== null ? Number(type.metro_limit_amount) : Number(type.limit_amount);
  if (!PER_UNIT_KINDS.includes(type.key)) return base;
  if (quantity === undefined || quantity <= 0) return base;
  return base * quantity;
}

const CLAIM_SELECT = `
  SELECT ec.*, u.name AS user_name, av.name AS approver_name, sav.name AS second_approver_name,
    l.full_name AS lead_full_name, l.lead_number AS lead_number, o.name AS opportunity_name
  FROM expense_claims ec
  JOIN users u ON u.id = ec.user_id
  LEFT JOIN users av ON av.id = ec.approver_id
  LEFT JOIN users sav ON sav.id = ec.second_approver_id
  LEFT JOIN leads l ON l.id = ec.linked_lead_id
  LEFT JOIN opportunities o ON o.id = ec.linked_opportunity_id
`;

export async function listMyClaims(userId: string) {
  const result = await pool.query<ExpenseClaimRow>(`${CLAIM_SELECT} WHERE ec.user_id = $1 ORDER BY ec.created_at DESC`, [userId]);
  return result.rows.map(toPublicExpenseClaim);
}

// Direct reports only, same "reporting manager" framing Leave uses - not
// the whole subtree.
export async function listTeamClaims(managerId: string) {
  const result = await pool.query<ExpenseClaimRow>(
    `${CLAIM_SELECT} WHERE u.manager_id = $1 ORDER BY ec.created_at DESC`,
    [managerId]
  );
  return result.rows.map(toPublicExpenseClaim);
}

export async function listPendingApprovals(userId: string) {
  const result = await pool.query<ExpenseClaimRow>(
    `${CLAIM_SELECT}
     WHERE ec.status = 'pending' AND (
       (ec.approver_id = $1 AND ec.approver_decision IS NULL)
       OR (ec.second_approver_id = $1 AND ec.approver_decision = 'approved' AND ec.second_approver_decision IS NULL)
     )
     ORDER BY ec.created_at ASC`,
    [userId]
  );
  return result.rows.map(toPublicExpenseClaim);
}

async function getClaimById(id: string): Promise<ExpenseClaimRow> {
  const result = await pool.query<ExpenseClaimRow>(`${CLAIM_SELECT} WHERE ec.id = $1`, [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Expense claim not found");
  }
  return result.rows[0];
}

export async function createExpenseClaim(userId: string, input: CreateExpenseClaimInput, receiptFile?: Express.Multer.File) {
  const type = await getExpenseTypeByKey(input.expenseTypeKey);

  if (type.receipt_required && !receiptFile) {
    throw new ApiError(422, `${type.label} requires a receipt`);
  }
  if (type.requires_linked_opportunity && !input.linkedOpportunityId) {
    throw new ApiError(422, `${type.label} needs a linked opportunity`);
  }

  const limit = effectiveLimit(type, input.quantity);
  const isPolicyBreach = input.amount > limit;

  const managerId = await getDirectManagerId(userId);
  const autoApprove = managerId === null;
  const secondApproverId = managerId ? await resolveSecondApprover(userId, managerId, input.amount) : null;

  const result = await pool.query<{ id: string }>(
    `INSERT INTO expense_claims (
       user_id, expense_type_key, title, expense_date, amount, quantity, linked_lead_id, linked_opportunity_id,
       receipt_file_path, receipt_original_filename, is_policy_breach, policy_limit_at_submission,
       approver_id, second_approver_id, status, approver_decision, approver_decided_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      userId,
      input.expenseTypeKey,
      input.title,
      input.expenseDate,
      input.amount,
      input.quantity ?? null,
      input.linkedLeadId ?? null,
      input.linkedOpportunityId ?? null,
      receiptFile?.path ?? null,
      receiptFile?.originalname ?? null,
      isPolicyBreach,
      limit,
      managerId,
      secondApproverId,
      autoApprove ? "approved" : "pending",
      autoApprove ? "approved" : null,
      autoApprove ? new Date() : null,
    ]
  );
  return toPublicExpenseClaim(await getClaimById(result.rows[0].id));
}

export async function decideExpenseClaim(claimId: string, deciderId: string, decision: "approved" | "rejected", note?: string) {
  const claim = await getClaimById(claimId);
  if (claim.status !== "pending") {
    throw new ApiError(409, "This claim has already been decided");
  }

  const isFirstApprover = claim.approver_id === deciderId && claim.approver_decision === null;
  const isSecondApprover =
    claim.second_approver_id === deciderId && claim.approver_decision === "approved" && claim.second_approver_decision === null;

  if (!isFirstApprover && !isSecondApprover) {
    throw new ApiError(403, "You're not the approver for this claim");
  }

  if (isFirstApprover) {
    const finalStatus = decision === "rejected" ? "rejected" : claim.second_approver_id ? "pending" : "approved";
    await pool.query(
      `UPDATE expense_claims SET approver_decision = $1, approver_decided_at = now(), status = $2, decision_note = COALESCE($3, decision_note), updated_at = now() WHERE id = $4`,
      [decision, finalStatus, note ?? null, claimId]
    );
  } else {
    await pool.query(
      `UPDATE expense_claims SET second_approver_decision = $1, second_approver_decided_at = now(), status = $2, decision_note = COALESCE($3, decision_note), updated_at = now() WHERE id = $4`,
      [decision, decision, note ?? null, claimId]
    );
  }

  return toPublicExpenseClaim(await getClaimById(claimId));
}

export async function markClaimPaid(claimId: string, payerId: string) {
  const claim = await getClaimById(claimId);
  if (claim.status !== "approved") {
    throw new ApiError(409, "Only an approved, unpaid claim can be marked paid");
  }
  await pool.query(`UPDATE expense_claims SET status = 'paid', paid_by = $1, paid_at = now(), updated_at = now() WHERE id = $2`, [
    payerId,
    claimId,
  ]);
  return toPublicExpenseClaim(await getClaimById(claimId));
}

export async function getClaimFile(claimId: string): Promise<{ filePath: string; originalFilename: string }> {
  const claim = await getClaimById(claimId);
  if (!claim.receipt_file_path || !claim.receipt_original_filename) {
    throw new ApiError(404, "No receipt was uploaded for this claim");
  }
  return { filePath: claim.receipt_file_path, originalFilename: claim.receipt_original_filename };
}

// Real, on-disk storage, same pattern as lead-document-service.ts.
const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads", "expense-receipts");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export const receiptUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new ApiError(422, "Only JPG, PNG, WEBP or PDF files are accepted"));
      return;
    }
    cb(null, true);
  },
});
