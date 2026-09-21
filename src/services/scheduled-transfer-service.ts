import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";

export const TRANSFER_TYPES = ["territory", "bulk_reassign", "exit"] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

interface ScheduledTransferRow {
  id: string;
  transfer_type: TransferType;
  from_user_id: string | null;
  to_user_id: string | null;
  old_territory: string | null;
  new_territory: string | null;
  effective_date: string;
  status: "scheduled" | "completed";
  lead_count: number;
  opportunity_count: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
}

function toPublicTransfer(row: ScheduledTransferRow) {
  return {
    id: row.id,
    transferType: row.transfer_type,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    oldTerritory: row.old_territory,
    newTerritory: row.new_territory,
    effectiveDate: row.effective_date,
    status: row.status,
    leadCount: row.lead_count,
    opportunityCount: row.opportunity_count,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// The lazy-apply step the user asked for instead of a job scheduler: any
// 'scheduled' row whose effective_date has arrived gets its real data
// change made right now, then flips to 'completed'. Called at the top of
// every read, so nobody needs to remember to run this - the next person
// who opens Reporting lines (or Territory & targets) triggers it.
async function applyDueTransfers(): Promise<void> {
  const due = await pool.query<ScheduledTransferRow>(
    "SELECT * FROM scheduled_transfers WHERE status = 'scheduled' AND effective_date <= CURRENT_DATE"
  );

  for (const row of due.rows) {
    if (row.transfer_type === "bulk_reassign" && row.from_user_id && row.to_user_id) {
      await pool.query("UPDATE leads SET owner_id = $1, updated_at = now() WHERE owner_id = $2 AND is_deleted = false", [
        row.to_user_id,
        row.from_user_id,
      ]);
    } else if (row.transfer_type === "territory" && row.from_user_id && row.new_territory) {
      await pool.query("UPDATE users SET territory = $1 WHERE id = $2", [row.new_territory, row.from_user_id]);
      if (row.old_territory) {
        await pool.query(
          "UPDATE leads SET territory = $1, updated_at = now() WHERE owner_id = $2 AND territory = $3 AND is_deleted = false",
          [row.new_territory, row.from_user_id, row.old_territory]
        );
      }
    }
    // 'exit' has no target to move records to yet - the note says records
    // are queued for a manual bulk re-assign, so applying it only means
    // marking the date as arrived, not moving anything automatically.
    await pool.query("UPDATE scheduled_transfers SET status = 'completed', applied_at = now() WHERE id = $1", [row.id]);
  }
}

export async function listScheduledTransfers(requestingUserId: string, requestingRole: string) {
  await applyDueTransfers();

  if (requestingRole === "admin") {
    const result = await pool.query<ScheduledTransferRow>("SELECT * FROM scheduled_transfers ORDER BY effective_date DESC, created_at DESC");
    return result.rows.map(toPublicTransfer);
  }

  const result = await pool.query<ScheduledTransferRow>(
    `${SUBTREE_CTE}
     SELECT * FROM scheduled_transfers
     WHERE from_user_id IN (SELECT id FROM subtree) OR to_user_id IN (SELECT id FROM subtree)
     ORDER BY effective_date DESC, created_at DESC`,
    [requestingUserId]
  );
  return result.rows.map(toPublicTransfer);
}

async function assertInOwnSubtree(requestingUserId: string, requestingRole: string, targetUserId: string): Promise<void> {
  if (requestingRole === "admin") return;
  const inScope = await pool.query(`${SUBTREE_CTE} SELECT 1 FROM subtree WHERE id = $2`, [requestingUserId, targetUserId]);
  if ((inScope.rowCount ?? 0) === 0) {
    throw new ApiError(403, "That person is outside your own reporting tree");
  }
}

export interface CreateTerritoryTransferInput {
  fromUserId: string;
  newTerritory: string;
  effectiveDate: string;
  note?: string;
}

export async function createTerritoryTransfer(input: CreateTerritoryTransferInput, requestingUserId: string, requestingRole: string) {
  await assertInOwnSubtree(requestingUserId, requestingRole, input.fromUserId);

  const person = await pool.query<{ territory: string | null }>("SELECT territory FROM users WHERE id = $1", [input.fromUserId]);
  if (person.rows.length === 0) {
    throw new ApiError(404, "Person not found");
  }
  const oldTerritory = person.rows[0].territory;

  const counts = await pool.query<{ leads: string }>(
    "SELECT COUNT(*) AS leads FROM leads WHERE owner_id = $1 AND is_deleted = false" + (oldTerritory ? " AND territory = $2" : ""),
    oldTerritory ? [input.fromUserId, oldTerritory] : [input.fromUserId]
  );

  const result = await pool.query<ScheduledTransferRow>(
    `INSERT INTO scheduled_transfers (transfer_type, from_user_id, old_territory, new_territory, effective_date, lead_count, note, created_by)
     VALUES ('territory', $1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.fromUserId, oldTerritory, input.newTerritory, input.effectiveDate, Number(counts.rows[0].leads), input.note ?? null, requestingUserId]
  );
  return toPublicTransfer(result.rows[0]);
}

export interface CreateScheduledReassignInput {
  fromUserId: string;
  toUserId: string;
  effectiveDate: string;
  note?: string;
}

export async function createScheduledReassign(input: CreateScheduledReassignInput, requestingUserId: string, requestingRole: string) {
  if (input.fromUserId === input.toUserId) {
    throw new ApiError(422, "Source and destination must be different people");
  }
  await assertInOwnSubtree(requestingUserId, requestingRole, input.fromUserId);
  await assertInOwnSubtree(requestingUserId, requestingRole, input.toUserId);

  const counts = await pool.query<{ leads: string; opportunities: string }>(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE owner_id = $1 AND is_deleted = false) AS leads,
       (SELECT COUNT(*) FROM opportunities o JOIN leads l ON l.id = o.lead_id WHERE l.owner_id = $1 AND o.is_deleted = false AND l.is_deleted = false) AS opportunities`,
    [input.fromUserId]
  );

  const result = await pool.query<ScheduledTransferRow>(
    `INSERT INTO scheduled_transfers (transfer_type, from_user_id, to_user_id, effective_date, lead_count, opportunity_count, note, created_by)
     VALUES ('bulk_reassign', $1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.fromUserId,
      input.toUserId,
      input.effectiveDate,
      Number(counts.rows[0].leads),
      Number(counts.rows[0].opportunities),
      input.note ?? null,
      requestingUserId,
    ]
  );
  return toPublicTransfer(result.rows[0]);
}

export interface CreateExitInput {
  fromUserId: string;
  effectiveDate: string;
}

export async function createExit(input: CreateExitInput, requestingUserId: string, requestingRole: string) {
  await assertInOwnSubtree(requestingUserId, requestingRole, input.fromUserId);

  const counts = await pool.query<{ leads: string }>("SELECT COUNT(*) AS leads FROM leads WHERE owner_id = $1 AND is_deleted = false", [
    input.fromUserId,
  ]);
  const leadCount = Number(counts.rows[0].leads);

  const result = await pool.query<ScheduledTransferRow>(
    `INSERT INTO scheduled_transfers (transfer_type, from_user_id, effective_date, lead_count, note, created_by)
     VALUES ('exit', $1, $2, $3, $4, $5)
     RETURNING *`,
    [input.fromUserId, input.effectiveDate, leadCount, `${leadCount} lead${leadCount === 1 ? "" : "s"} queued for bulk re-assign`, requestingUserId]
  );
  return toPublicTransfer(result.rows[0]);
}
