import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { recordAuditEvent } from "./audit-log-service";
import { createLead, getLeadById, isLeadInOwnerScope, updateLead, type CreateLeadInput } from "./lead-service";
import { createActivityForLead } from "./activity-service";

const CALL_CENTER_STAGE = "Call Center";
const QUALIFIED_STAGE = "Qualified";

// Ownership-based visibility (isLeadVisibleToUser/isLeadInOwnerScope) means
// the Call Center rep who qualified and sent this lead would otherwise lose
// every trace of it the instant ownership moves to Field Sales - not just
// the ability to edit it (correct), but the ability to even see their own
// call history and recordings on it (not correct - they did real work here,
// a clean handoff shouldn't erase it from their view). A lead_shares row is
// exactly the read-only grant this app already has for this: included in
// isLeadVisibleToUser, deliberately excluded from isLeadInOwnerScope (see
// that function's own comment), so this never reopens any ability to edit,
// qualify, or re-send the lead - only to look at it. No requirePermission
// check here (unlike shareLead in lead-service.ts) because this runs as a
// side effect of an action sendToField already authorized at its own entry
// point, after ownership has already moved on - the normal share flow's own
// isLeadInOwnerScope check would wrongly reject it at that point.
async function shareLeadBackToSender(leadId: string, senderId: string): Promise<void> {
  await pool.query(
    `INSERT INTO lead_shares (lead_id, shared_with_user_id, shared_by_user_id)
     VALUES ($1, $2, $2)
     ON CONFLICT (lead_id, shared_with_user_id) DO NOTHING`,
    [leadId, senderId]
  );
}

export interface SwapCandidate {
  id: string;
  name: string;
  email: string;
}

interface LeadAssignmentFacts {
  status: string;
  pincode: string | null;
  category: string | null;
  // Current owner's security tier - the only reliable way to tell "already
  // handed to Field Sales" apart from "still with Call Center", since
  // sendToField deliberately never changes status (a handed-off lead keeps
  // showing "Qualified" while the field rep works it, same as any other
  // lead at that stage) - owner_id is the one thing that actually changes.
  ownerRole: string | null;
}

async function getLeadAssignmentFacts(leadId: string): Promise<LeadAssignmentFacts> {
  const result = await pool.query<LeadAssignmentFacts>(
    `SELECT l.status, l.pincode, l.category, u.role AS "ownerRole"
     FROM leads l
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.id = $1`,
    [leadId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, "Lead not found");
  }
  return result.rows[0];
}

// Only COCO/FOFO carry a real Operation Type to match against - every other
// lead category (Stockist, B2B, Lifestyle, ...) has no field-coverage
// concept at all, so those leads match on pincode alone rather than being
// unmatchable because no field employee has that operation type set.
function operationTypeFilterFor(category: string | null): "COCO" | "FOFO" | null {
  return category === "COCO" || category === "FOFO" ? category : null;
}

// Active field employees who actually cover this pincode (and, when the
// lead's category is COCO/FOFO, whose own Operation Type matches it or is
// 'Both'). Deliberately allows more than one match - that overlap is
// intentional (see employee_pincodes), not a data problem to resolve here.
async function getFieldCandidates(pincode: string | null, category: string | null): Promise<SwapCandidate[]> {
  if (!pincode) return [];
  const operationFilter = operationTypeFilterFor(category);

  const result = await pool.query<SwapCandidate>(
    `SELECT DISTINCT u.id, u.name, u.email
     FROM users u
     JOIN employee_pincodes ep ON ep.user_id = u.id
     WHERE u.role = 'agent' AND u.is_active = true AND ep.pincode = $1
       AND ($2::varchar IS NULL OR u.operation_type = $2 OR u.operation_type = 'Both')
     ORDER BY u.name ASC`,
    [pincode, operationFilter]
  );
  return result.rows;
}

// Least-loaded round-robin among EVERY active field employee, regardless of
// pincode - used only when zero employees actually cover this lead's
// pincode/category. Mirrors resolveCallCenterAssignee's own round-robin
// exactly (see lead-service.ts), just scoped to role='agent' instead.
//
// Why fall back instead of refusing (the original design): real routing
// tools converge on the same answer for an unmatched record - Salesforce/
// HubSpot lead-routing guidance is explicit that "a blank owner is the
// worst outcome" and every lead must land on a *named* owner, typically a
// governed exceptions queue, rather than sitting invisible waiting to be
// lost. sendToField's caller (see below) always pairs this with its own
// distinct audit-trail entry, so the fallback is loud and reversible - not
// a silent guess - the moment real pincode coverage is configured for that
// area, an admin/manager can Reassign it properly via the existing swap tool.
async function resolveFieldFallbackAssignee(): Promise<{ id: string; name: string } | null> {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT u.id, u.name
     FROM users u
     WHERE u.role = 'agent' AND u.is_active = true
     ORDER BY (
       SELECT COUNT(*) FROM leads l WHERE l.owner_id = u.id AND l.is_deleted = false
     ) ASC, random()
     LIMIT 1`
  );
  return result.rows[0] ?? null;
}

async function getCallCenterCandidates(): Promise<SwapCandidate[]> {
  const result = await pool.query<SwapCandidate>(
    "SELECT id, name, email FROM users WHERE role = 'call_center' AND is_active = true ORDER BY name ASC"
  );
  return result.rows;
}

export interface LogCallDispositionInput {
  disposition: string;
  notes?: string;
  // Only set (and only meaningful) when disposition is "Call Back" - see
  // the real second Activity this creates below.
  callbackAt?: string;
}

// One activities row per attempt (type='call'), same durable per-call
// history every other call in this app already gets - kept in its own
// `details.disposition` key, deliberately separate from Smartflo's own
// auto-generated `details.outcome` connection string (see
// smartflo-service.ts), so a business disposition and a telephony result
// never collide on the same row. No cap on how many times this can be
// logged - "call me later" can recur for months, by design.
export async function logCallDisposition(leadId: string, input: LogCallDispositionInput, requestingUserId: string) {
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  await pool.query(
    `INSERT INTO activities (type, lead_id, assigned_to, status, details, created_by)
     VALUES ('call', $1, $2, 'completed', $3::jsonb, $2)`,
    [leadId, requestingUserId, JSON.stringify({ disposition: input.disposition, notes: input.notes ?? null })]
  );

  // A second, separate Activity - this one's still pending, not a record of
  // what just happened but a real commitment for what happens next. This is
  // the actual fix for "Call Back" being a dead end: before this, picking
  // it just saved text saying "call back" with nothing anywhere tracking
  // when, so the Call Center Dashboard's "Call queue" (which reads real
  // pending call Activities - see listUpcomingCalls) could never show
  // anything. Reuses createActivityForLead rather than a raw INSERT here,
  // so it's identical in every way to a call scheduled by hand from the
  // Activity Calendar's own "+ Add action" - same table, same status
  // convention ('pending', createActivityForLead's own default), same
  // overdue/due-today logic, no separate code path to keep in sync.
  if (input.disposition === "Call Back" && input.callbackAt) {
    await createActivityForLead(
      leadId,
      { type: "call", subject: "Call back", dueDate: input.callbackAt, assignedTo: requestingUserId },
      requestingUserId
    );
  }

  await pool.query(
    `UPDATE leads SET call_attempt_count = call_attempt_count + 1, last_call_outcome = $1, last_call_at = now()
     WHERE id = $2`,
    [input.disposition, leadId]
  );

  return getLeadById(leadId, requestingUserId);
}

// A deliberate, separate click from logging a disposition - "Call Done And
// Interested" is just what happened on one call, Qualified is the agent's
// own judgment call that this lead is worth handing off. Only valid from
// the Call Center stage itself: a lead that's already Qualified/with Field
// has nothing left to qualify, and this is not how a "Not Interested" lead
// is ever revived (it just stays in Call Center, re-callable, by design).
export async function qualifyLead(leadId: string, requestingUserId: string, ipAddress?: string | null) {
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const facts = await getLeadAssignmentFacts(leadId);
  if (facts.status !== CALL_CENTER_STAGE) {
    throw new ApiError(422, `Only a lead in the "${CALL_CENTER_STAGE}" stage can be marked Qualified`);
  }

  return updateLead(leadId, { status: QUALIFIED_STAGE }, requestingUserId, ipAddress);
}

// Who this lead could be handed to right now - before Qualified, any active
// Call Center employee (no pincode concept on that side); at/after
// Qualified, only field employees who actually cover its pincode. Reused by
// both the Send to Field Sales flow (to disambiguate multiple matches) and
// the general Reassign/Swap action.
export async function getSwapCandidates(leadId: string, requestingUserId: string): Promise<SwapCandidate[]> {
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const facts = await getLeadAssignmentFacts(leadId);
  if (facts.status === CALL_CENTER_STAGE) {
    return getCallCenterCandidates();
  }
  return getFieldCandidates(facts.pincode, facts.category);
}

// Requires Qualified first - this is the one deliberate manual checkpoint
// before a lead leaves Call Center, not an automatic side effect of marking
// it Qualified. More than one match requires the caller to pick (ownerId),
// since multiple field people covering the same pincode is intentional, not
// something to resolve by picking the first one arbitrarily. Zero coverage
// no longer blocks the handoff outright - see resolveFieldFallbackAssignee's
// own comment for why - it falls back to a flagged, audited assignment
// instead of leaving the customer stuck in Call Center indefinitely.
export async function sendToField(
  leadId: string,
  requestingUserId: string,
  chosenOwnerId: string | undefined,
  ipAddress?: string | null
) {
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const facts = await getLeadAssignmentFacts(leadId);
  if (facts.status !== QUALIFIED_STAGE) {
    throw new ApiError(422, `Only a "${QUALIFIED_STAGE}" lead can be sent to Field Sales`);
  }
  // sendToField never changes status (see LeadAssignmentFacts' own comment),
  // so a lead already with Field Sales still reads as "Qualified" - owner
  // role is the one real signal available here. Phrased as "already with a
  // field employee" rather than "already sent" since that's true regardless
  // of *how* it got there (this flow, or a lead a field rep created
  // themselves that reached Qualified on its own) - either way, sending it
  // to field again makes no sense, and without this guard a second click
  // here could silently re-route it out from under whoever's working it.
  // Reassign (admin/manager, same-pincode swap) is the correct tool for
  // "move it to someone else" after this point - deliberately untouched.
  if (facts.ownerRole === "agent") {
    throw new ApiError(422, "This lead is already with a field employee. Use Reassign to move it to someone else.");
  }

  const candidates = await getFieldCandidates(facts.pincode, facts.category);

  if (candidates.length === 0) {
    const fallback = await resolveFieldFallbackAssignee();
    if (!fallback) {
      // The one case that still has to come back as a real error: there is
      // no active field employee anywhere to fall back to, not even an
      // imperfect one.
      throw new ApiError(422, "No active field employee exists yet to receive this lead.");
    }

    const updated = await updateLead(leadId, { ownerId: fallback.id }, requestingUserId, ipAddress);
    await shareLeadBackToSender(leadId, requestingUserId);
    const actor = await pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [requestingUserId]);
    await recordAuditEvent({
      entityType: "lead",
      entityId: leadId,
      entityLabel: updated.fullName,
      action: "field_fallback_assignment",
      summary: `Sent to Field Sales as a fallback - no one covers pincode ${facts.pincode ?? "(none on file)"} - ${updated.fullName}`,
      oldValue: facts.pincode ? `No coverage for pincode ${facts.pincode}` : "No pincode on file",
      newValue: fallback.name,
      actorId: requestingUserId,
      actorName: actor.rows[0]?.name ?? null,
      ipAddress,
    });
    return updated;
  }

  let ownerId = chosenOwnerId;
  if (!ownerId) {
    if (candidates.length > 1) {
      throw new ApiError(422, "More than one field employee covers this pincode - choose one.", { candidates });
    }
    ownerId = candidates[0].id;
  } else if (!candidates.some((c) => c.id === ownerId)) {
    throw new ApiError(422, "That employee does not cover this lead's pincode");
  }

  const updated = await updateLead(leadId, { ownerId }, requestingUserId, ipAddress);
  await shareLeadBackToSender(leadId, requestingUserId);
  return updated;
}

// The general-purpose swap, usable any time (not just the initial Field
// hand-off) - e.g. Person A is unavailable, hand their leads to Person B.
// Server-side validated against the same eligible set swap-candidates
// returns, regardless of what the UI already filtered to, since this is the
// one check that must not be trusted to the frontend. Goes through the
// existing updateLead so the before/after owner change is audited exactly
// like any other reassignment in this app - no separate history mechanism.
export async function reassignLead(
  leadId: string,
  newOwnerId: string,
  requestingUserId: string,
  ipAddress?: string | null
) {
  const inScope = await isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }

  const facts = await getLeadAssignmentFacts(leadId);
  const candidates =
    facts.status === CALL_CENTER_STAGE ? await getCallCenterCandidates() : await getFieldCandidates(facts.pincode, facts.category);

  if (!candidates.some((c) => c.id === newOwnerId)) {
    throw new ApiError(
      422,
      facts.status === CALL_CENTER_STAGE
        ? "That person is not an active Call Center employee"
        : "That employee does not cover this lead's pincode - pick someone from the eligible list",
      { candidates }
    );
  }

  return updateLead(leadId, { ownerId: newOwnerId }, requestingUserId, ipAddress);
}

// The one gap left once a Call Center agent could only ever work leads that
// landed in their queue automatically (bulk import, website form, QR
// campaign) - there was no way to log a contact who just called in directly.
// ownerId/status are stripped and never taken from the request: this path
// only ever means "I'm on the phone with this person right now, put them in
// my own queue" - never a way to create a lead for, or as, someone else.
// Reuses createLead's own duplicate-phone guard and every other validation
// as-is; the only thing special here is who ends up owning it and which
// stage it starts at.
export async function createOwnQueueLead(
  input: CreateLeadInput,
  requestingUserId: string,
  ipAddress?: string | null
) {
  const { ownerId: _ignoredOwnerId, status: _ignoredStatus, ...rest } = input;
  return createLead(rest, requestingUserId, ipAddress, { requiresQualification: true, assignToCreator: true });
}
