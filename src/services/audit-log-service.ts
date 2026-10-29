import { pool } from "../config/db";

export interface AuditEventInput {
  entityType: string;
  // Null for an event with no single database row to point at - e.g.
  // "Admin access granted to the whole call_center tier" describes a role,
  // not one record. entityLabel still carries the real identifying text in
  // that case. Every other caller keeps passing a real id as before.
  entityId: string | null;
  entityLabel?: string | null;
  action: string;
  summary: string;
  oldValue?: string | null;
  newValue?: string | null;
  actorId: string | null;
  actorName: string | null;
  ipAddress?: string | null;
}

// Real writer, called from the actual mutation points (updateLead,
// deleteLead, the three real decide* functions, updateAssignmentRule, the
// consent capture inside createLead) - never a bulk backfill or synthetic
// event. A row only exists here because something genuinely happened.
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (entity_type, entity_id, entity_label, action, summary, old_value, new_value, actor_id, actor_name, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.entityType,
      input.entityId,
      input.entityLabel ?? null,
      input.action,
      input.summary,
      input.oldValue ?? null,
      input.newValue ?? null,
      input.actorId,
      input.actorName,
      input.ipAddress ?? null,
    ]
  );
}

interface AuditLogRow {
  id: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  action: string;
  summary: string;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null;
  actor_name: string | null;
  ip_address: string | null;
  created_at: string;
}

function toPublicEvent(row: AuditLogRow) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    action: row.action,
    summary: row.summary,
    oldValue: row.old_value,
    newValue: row.new_value,
    actorName: row.actor_name,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

// Was a silent, unconditional LIMIT 100 with no way to page further - real
// audit history beyond the most recent 100 events was permanently
// unreachable through this endpoint. Now genuinely paginated: callers can
// walk the whole table via page/limit, and total tells them when to stop.
// Scoped to one entity - powers the Customer detail panel's Activity tab
// (merged alongside real Activities and Support Tickets), not a general
// listing endpoint.
export async function listAuditLogForEntity(entityType: string, entityId: string) {
  const result = await pool.query<AuditLogRow>(
    "SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC",
    [entityType, entityId]
  );
  return result.rows.map(toPublicEvent);
}

// Bulk sibling of listAuditLogForEntity - every event for MANY entities in
// one query (used by the Leads export's owner-trail reconstruction and
// History sheet), not one query per lead. Ascending by created_at so a
// caller can replay each entity's own events oldest-first; group by
// entityId client-side.
export async function listAuditLogForEntities(entityType: string, entityIds: string[]) {
  if (entityIds.length === 0) return [];
  const result = await pool.query<AuditLogRow>(
    "SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = ANY($2) ORDER BY entity_id, created_at ASC",
    [entityType, entityIds]
  );
  return result.rows.map(toPublicEvent);
}

export async function listAuditLog(page: number, limit: number) {
  const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM audit_log");
  const offset = (page - 1) * limit;
  const result = await pool.query<AuditLogRow>(
    "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return { events: result.rows.map(toPublicEvent), total: Number(countResult.rows[0].count) };
}
