import { listLeadsForExport, type ExportLeadRow, type ListLeadsFilters } from "./lead-service";
import { getBulkActivitiesForLeads, listCommentsForActivities } from "./activity-service";
import { listAuditLogForEntities } from "./audit-log-service";

export interface ExportLeadsResultRow extends ExportLeadRow {
  flcHandledBy: string;
  slcHandledBy: string;
  fieldSalesExecutive: string;
}

export interface ExportHistoryRow {
  leadNumber: number;
  leadName: string;
  date: string;
  kind: "Activity" | "Remark" | "History";
  detail: string;
  actor: string;
}

interface OwnerTrailEvent {
  action: string;
  oldValue: string | null;
  newValue: string | null;
}

interface CurrentOwnerFacts {
  status: string;
  ownerName: string | null;
  ownerRole: string | null;
}

// "{status} · {ownerName}" - the exact format lead-service.ts's updateLead
// writes for an "escalated" event's old/new value (both status and owner
// changing together).
function splitStageOwner(value: string): { stage: string; owner: string } | null {
  const parts = value.split(" · ");
  if (parts.length !== 2) return null;
  return { stage: parts[0].trim(), owner: parts[1].trim() };
}

// Replays one lead's own audit_log slice (oldest -> newest) to derive who
// held it at each real tier - see the plan's "Owner-trail reconstruction"
// section for the full reasoning behind each branch. Pure/testable on
// purpose: no DB access in here, just the four audit actions lead-service.ts
// and lead-call-center-service.ts actually produce for a lead.
export function reconstructOwnerTrail(eventsOldestFirst: OwnerTrailEvent[], current: CurrentOwnerFacts) {
  const stageOwner: Record<string, string> = {};
  let fieldFallbackOwner: string | null = null;
  let currentStage: string | null = null;

  for (const event of eventsOldestFirst) {
    if (event.action === "escalated" && event.oldValue && event.newValue) {
      const from = splitStageOwner(event.oldValue);
      const to = splitStageOwner(event.newValue);
      // Only backfill the earlier stage the first time it's seen - a later,
      // unrelated event should never clobber the real original snapshot.
      if (from && stageOwner[from.stage] === undefined) stageOwner[from.stage] = from.owner;
      if (to) {
        stageOwner[to.stage] = to.owner;
        currentStage = to.stage;
      }
    } else if (event.action === "status_changed" && event.newValue) {
      // Owner didn't change here (e.g. qualifyLead's SLC -> Qualified) -
      // just advances the tracker so a later owner-only event attributes to
      // the right stage.
      currentStage = event.newValue;
    } else if (event.action === "owner_reassigned" && event.newValue && currentStage) {
      // Covers both the admin's manual Reassign and sendToField (which
      // deliberately never changes status - see sendToField's own comment),
      // attributed to whatever stage is current right now.
      stageOwner[currentStage] = event.newValue;
    } else if (event.action === "field_fallback_assignment" && event.newValue) {
      fieldFallbackOwner = event.newValue;
    }
  }

  // A lead's very first owner is never itself audited (createLead writes no
  // audit row) - if replay never set a tier, only trust the lead's *current*
  // live owner for that tier if it never left that tier at all.
  const flcHandledBy = stageOwner.FLC ?? (current.status === "FLC" ? current.ownerName : null) ?? "-";
  const slcHandledBy = stageOwner.SLC ?? (current.status === "SLC" ? current.ownerName : null) ?? "-";
  const fieldSalesExecutive =
    fieldFallbackOwner ?? stageOwner.Qualified ?? (current.ownerRole === "agent" ? current.ownerName : null) ?? "-";

  return { flcHandledBy, slcHandledBy, fieldSalesExecutive };
}

// Orchestrates the Leads export: the filtered lead rows (same rules as the
// Leads page itself), plus every lead's owner trail and full history/remarks
// - all bulk-fetched (one query per source, never N+1 per lead).
export async function getLeadsExportData(requestingUserId: string, filters: Omit<ListLeadsFilters, "page" | "limit">) {
  const leads = await listLeadsForExport(requestingUserId, filters);
  const leadIds = leads.map((l) => l.id);

  const [activities, auditEvents] = await Promise.all([
    getBulkActivitiesForLeads(leadIds),
    listAuditLogForEntities("lead", leadIds),
  ]);
  const comments = await listCommentsForActivities(activities.map((a) => a.id));

  const activitiesByLead = new Map<string, typeof activities>();
  for (const activity of activities) {
    if (!activity.leadId) continue;
    const bucket = activitiesByLead.get(activity.leadId) ?? [];
    bucket.push(activity);
    activitiesByLead.set(activity.leadId, bucket);
  }
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const auditByLead = new Map<string, typeof auditEvents>();
  for (const event of auditEvents) {
    if (!event.entityId) continue;
    const bucket = auditByLead.get(event.entityId) ?? [];
    bucket.push(event);
    auditByLead.set(event.entityId, bucket);
  }
  const commentsByLead = new Map<string, typeof comments>();
  for (const comment of comments) {
    const parentLeadId = activityById.get(comment.activityId)?.leadId;
    if (!parentLeadId) continue;
    const bucket = commentsByLead.get(parentLeadId) ?? [];
    bucket.push(comment);
    commentsByLead.set(parentLeadId, bucket);
  }

  const resultLeads: ExportLeadsResultRow[] = [];
  const history: ExportHistoryRow[] = [];

  for (const lead of leads) {
    const leadAuditEvents = auditByLead.get(lead.id) ?? []; // already oldest-first
    const trail = reconstructOwnerTrail(leadAuditEvents, {
      status: lead.status,
      ownerName: lead.ownerName,
      ownerRole: lead.ownerRole,
    });
    resultLeads.push({ ...lead, ...trail });

    for (const activity of activitiesByLead.get(lead.id) ?? []) {
      const detailParts = [activity.subject ?? activity.type];
      const disposition = typeof activity.details.disposition === "string" ? activity.details.disposition : undefined;
      const notes = typeof activity.details.notes === "string" ? activity.details.notes : undefined;
      if (disposition) detailParts.push(disposition);
      if (notes) detailParts.push(notes);
      history.push({
        leadNumber: lead.leadNumber,
        leadName: lead.fullName,
        date: activity.status === "completed" ? activity.updatedAt : activity.createdAt,
        kind: "Activity",
        detail: detailParts.join(" - "),
        actor: activity.createdByName ?? "-",
      });
    }

    for (const comment of commentsByLead.get(lead.id) ?? []) {
      history.push({
        leadNumber: lead.leadNumber,
        leadName: lead.fullName,
        date: comment.createdAt,
        kind: "Remark",
        detail: comment.comment,
        actor: comment.userName ?? "-",
      });
    }

    for (const event of leadAuditEvents) {
      history.push({
        leadNumber: lead.leadNumber,
        leadName: lead.fullName,
        date: event.createdAt,
        kind: "History",
        detail: event.oldValue && event.newValue ? `${event.summary}: ${event.oldValue} -> ${event.newValue}` : event.summary,
        actor: event.actorName ?? "-",
      });
    }
  }

  history.sort((a, b) => {
    if (a.leadNumber !== b.leadNumber) return a.leadNumber - b.leadNumber;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return { leads: resultLeads, history };
}
