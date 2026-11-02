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
//
// Ownership is now sticky through New -> FLC -> SLC (startFlc/escalateTier
// no longer reassign - client-confirmed, see their own comments), so most
// stage moves are a plain "status_changed" with no owner info attached at
// all. A stage entered that way is "pending": we don't yet know who held it,
// but since ownership never silently changes on its own, whoever the NEXT
// real owner-change event's oldValue names (an owner_reassigned, or an
// escalated pair, if one still occurs) must have been the owner all along -
// that single fact retroactively resolves every pending stage still unset,
// not just the one stage that event names directly.
export function reconstructOwnerTrail(eventsOldestFirst: OwnerTrailEvent[], current: CurrentOwnerFacts) {
  const stageOwner: Record<string, string> = {};
  let fieldFallbackOwner: string | null = null;
  let currentStage: string | null = null;
  let lastKnownOwner: string | null = null;
  const pendingStages: string[] = [];

  // A stage was just entered (or, for the very first transition seen,
  // "re-entered" via that event's oldValue, since a lead's true starting
  // stage is itself never audited) - resolve it now if we already know the
  // owner, otherwise queue it for the next real owner-change event to
  // backfill.
  const enterStage = (stage: string) => {
    if (lastKnownOwner !== null) {
      if (stageOwner[stage] === undefined) stageOwner[stage] = lastKnownOwner;
    } else if (!pendingStages.includes(stage)) {
      pendingStages.push(stage);
    }
  };

  // The owner named here held every still-pending stage - only meaningful
  // the first time we ever learn a real name; once lastKnownOwner is set,
  // pendingStages is already empty and stays that way.
  const backfillPending = (ownerName: string) => {
    if (lastKnownOwner !== null) return;
    for (const stage of pendingStages) {
      if (stageOwner[stage] === undefined) stageOwner[stage] = ownerName;
    }
    pendingStages.length = 0;
  };

  for (const event of eventsOldestFirst) {
    if (event.action === "escalated" && event.oldValue && event.newValue) {
      const from = splitStageOwner(event.oldValue);
      const to = splitStageOwner(event.newValue);
      if (from) {
        if (stageOwner[from.stage] === undefined) stageOwner[from.stage] = from.owner;
        backfillPending(from.owner);
        lastKnownOwner = from.owner;
      }
      if (to) {
        stageOwner[to.stage] = to.owner;
        currentStage = to.stage;
        lastKnownOwner = to.owner;
      }
    } else if (event.action === "status_changed" && event.newValue) {
      // The first transition ever seen also tells us the lead's real
      // starting stage via oldValue - otherwise it would never be
      // attributable at all (createLead writes no audit row of its own).
      if (currentStage === null && event.oldValue) enterStage(event.oldValue);
      currentStage = event.newValue;
      enterStage(currentStage);
    } else if (event.action === "owner_reassigned" && event.newValue) {
      // Covers both the admin's manual Reassign and sendToField (which
      // deliberately never changes status - see sendToField's own comment).
      // oldValue is who held it through every pending stage up to now;
      // newValue is who holds the current stage from this point on.
      if (event.oldValue) backfillPending(event.oldValue);
      if (currentStage) stageOwner[currentStage] = event.newValue;
      lastKnownOwner = event.newValue;
    } else if (event.action === "field_fallback_assignment" && event.newValue) {
      fieldFallbackOwner = event.newValue;
      lastKnownOwner = event.newValue;
    }
  }

  // If replay never resolved a tier at all (no events ever touched it),
  // only trust the lead's *current* live owner for that tier if it never
  // left that tier in the first place.
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
