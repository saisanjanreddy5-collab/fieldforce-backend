import { pool } from "../config/db";

export interface AuditEventInput {
  entityType: string;
  entityId: string;
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
  entity_id: string;
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

export async function listAuditLog(limit = 100) {
  const result = await pool.query<AuditLogRow>("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1", [limit]);
  return result.rows.map(toPublicEvent);
}
