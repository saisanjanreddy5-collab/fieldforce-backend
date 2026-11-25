import { pool } from "../config/db";
import { ApiError } from "../utils/api-error";
import { SUBTREE_CTE } from "../utils/subtree";

const TRANSFER_TYPES = ["territory", "bulk_reassign", "exit"] as const;
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

// Applies every 'scheduled' row whose effective date has arrived (India
// time), then marks it 'completed'. Runs in the background every 15
// minutes (startScheduledTransferScheduler), and again whenever someone opens
// the transfers list so it is always current there. Row locks make
// overlapping runs safe.
async function applyDueTransfers(): Promise<void> {
  const due = await pool.query<ScheduledTransferRow>(
    // "Today" in India time - the server's own date is UTC, which ran a
    // transfer dated today only after 5:30 AM IST, or a day early late at night.
    `SELECT * FROM scheduled_transfers
     WHERE status = 'scheduled' AND effective_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
     ORDER BY effective_date ASC, created_at ASC`
  );

  for (const row of due.rows) {
    // Each row's writes are all-or-nothing - previously a territory
    // transfer's two statements ran as separate unwrapped queries, so a
    // failure on the second left the user's own territory already changed
    // but their leads' territory not, with the row stuck at 'scheduled'
    // forever (looking pending while actually half-applied). A try/catch
    // per row (not one around the whole loop) also means one bad row can't
    // block every other due transfer in the same batch from applying.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Two people opening the page at the same moment must not both apply
      // the same transfer: lock this row, and skip it if someone else has it
      // or already finished it.
      const claimed = await client.query(
        "SELECT 1 FROM scheduled_transfers WHERE id = $1 AND status = 'scheduled' FOR UPDATE SKIP LOCKED",
        [row.id]
      );
      if ((claimed.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        continue;
      }
      if (row.transfer_type === "bulk_reassign" && row.from_user_id && row.to_user_id) {
        const moved = await client.query<{ id: string }>(
          "UPDATE leads SET owner_id = $1, updated_at = now() WHERE owner_id = $2 AND is_deleted = false RETURNING id",
          [row.to_user_id, row.from_user_id]
        );
        // Each moved lead's History shows the reassignment, by whoever
        // scheduled the transfer.
        await client.query(
          `INSERT INTO audit_log (entity_type, entity_id, entity_label, action, summary, old_value, new_value, actor_id, actor_name)
           SELECT 'lead', l.id, l.full_name, 'owner_reassigned', 'Scheduled transfer - ' || l.full_name,
                  (SELECT name FROM users WHERE id = $2), (SELECT name FROM users WHERE id = $3),
                  $4::uuid, (SELECT name FROM users WHERE id = $4::uuid)
           FROM leads l WHERE l.id = ANY($1::uuid[])`,
          [moved.rows.map((r) => r.id), row.from_user_id, row.to_user_id, row.created_by]
        );
        // Without this, any lead in this batch that had already converted
        // leaves its customer account permanently attached to from_user_id
        // - the departed/previous rep keeps access to real accounts
        // (orders, invoices, credit) they no longer own, while to_user_id,
        // who just inherited this exact lead, gets none. Same owner_id
        // match the leads UPDATE above just used, same transaction.
        await client.query("UPDATE customers SET owner_id = $1, updated_at = now() WHERE owner_id = $2 AND is_deleted = false", [
          row.to_user_id,
          row.from_user_id,
        ]);
      } else if (row.transfer_type === "territory" && row.from_user_id && row.new_territory) {
        await client.query("UPDATE users SET territory = $1 WHERE id = $2", [row.new_territory, row.from_user_id]);
        if (row.old_territory) {
          const moved = await client.query<{ id: string }>(
            "UPDATE leads SET territory = $1, updated_at = now() WHERE owner_id = $2 AND territory = $3 AND is_deleted = false RETURNING id",
            [row.new_territory, row.from_user_id, row.old_territory]
          );
          await client.query(
            `INSERT INTO audit_log (entity_type, entity_id, entity_label, action, summary, old_value, new_value, actor_id, actor_name)
             SELECT 'lead', l.id, l.full_name, 'lead_field_updated', 'updated the territory (scheduled transfer)', $2, $3,
                    $4::uuid, (SELECT name FROM users WHERE id = $4::uuid)
             FROM leads l WHERE l.id = ANY($1::uuid[])`,
            [moved.rows.map((r) => r.id), row.old_territory, row.new_territory, row.created_by]
          );
        }
      }
      // 'exit' has no target to move records to yet - the note says records
      // are queued for a manual bulk re-assign, so applying it only means
      // marking the date as arrived, not moving anything automatically.
      await client.query("UPDATE scheduled_transfers SET status = 'completed', applied_at = now() WHERE id = $1", [row.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`applyDueTransfers: failed to apply scheduled_transfer ${row.id}`, err);
    } finally {
      client.release();
    }
  }
}

const TRANSFER_CHECK_INTERVAL_MS = 15 * 60_000;
let transferCheckRunning = false;

async function runDueTransfers(): Promise<void> {
  if (transferCheckRunning) return;
  transferCheckRunning = true;
  try {
    await applyDueTransfers();
  } catch (err) {
    console.error("Scheduled transfers check failed:", err instanceof Error ? err.message : err);
  } finally {
    transferCheckRunning = false;
  }
}

// A transfer dated today happens today, whether or not anyone opens the page.
export function startScheduledTransferScheduler(): void {
  void runDueTransfers();
  setInterval(() => void runDueTransfers(), TRANSFER_CHECK_INTERVAL_MS);
}

export interface ListScheduledTransfersFilters {
  page: number;
  limit: number;
}

export async function listScheduledTransfers(requestingUserId: string, requestingRole: string, filters: ListScheduledTransfersFilters) {
  await applyDueTransfers();

  const limit = filters.limit;
  const offset = (filters.page - 1) * filters.limit;

  if (requestingRole === "admin") {
    const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM scheduled_transfers");
    const result = await pool.query<ScheduledTransferRow>(
      "SELECT * FROM scheduled_transfers ORDER BY effective_date DESC, created_at DESC LIMIT $1 OFFSET $2",
      [limit, offset]
    );
    return { transfers: result.rows.map(toPublicTransfer), total: Number(countResult.rows[0].count) };
  }

  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE}
     SELECT COUNT(*) FROM scheduled_transfers
     WHERE from_user_id IN (SELECT id FROM subtree) OR to_user_id IN (SELECT id FROM subtree)`,
    [requestingUserId]
  );

  const result = await pool.query<ScheduledTransferRow>(
    `${SUBTREE_CTE}
     SELECT * FROM scheduled_transfers
     WHERE from_user_id IN (SELECT id FROM subtree) OR to_user_id IN (SELECT id FROM subtree)
     ORDER BY effective_date DESC, created_at DESC
     LIMIT $2 OFFSET $3`,
    [requestingUserId, limit, offset]
  );
  return { transfers: result.rows.map(toPublicTransfer), total: Number(countResult.rows[0].count) };
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

  // users.territory is unique - if someone else already holds it, the
  // transfer could never apply (it would just fail and stay "scheduled"
  // forever), so refuse it up front with a clear reason instead.
  // ...unless that person is themselves already scheduled to move off it
  // by the same date (a planned handover), and never if another pending
  // transfer is already heading into the same territory.
  const taken = await pool.query<{ name: string }>(
    `SELECT u.name FROM users u
     WHERE u.territory = $1 AND u.id <> $2
       AND NOT EXISTS (
         SELECT 1 FROM scheduled_transfers st
         WHERE st.status = 'scheduled' AND st.from_user_id = u.id AND st.old_territory = $1
           AND st.transfer_type = 'territory' AND st.effective_date <= $3
       )`,
    [input.newTerritory, input.fromUserId, input.effectiveDate]
  );
  if (taken.rows.length > 0) {
    throw new ApiError(409, `This territory already belongs to ${taken.rows[0].name}`);
  }
  const incoming = await pool.query(
    "SELECT 1 FROM scheduled_transfers WHERE status = 'scheduled' AND transfer_type = 'territory' AND new_territory = $1 AND from_user_id <> $2 LIMIT 1",
    [input.newTerritory, input.fromUserId]
  );
  if ((incoming.rowCount ?? 0) > 0) {
    throw new ApiError(409, "Another scheduled transfer is already moving someone into this territory");
  }

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
