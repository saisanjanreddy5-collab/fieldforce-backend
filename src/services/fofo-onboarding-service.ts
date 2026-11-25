import crypto from "crypto";
import { pool } from "../config/db";
import { ApiError } from "../utils/api-error";
import * as leadService from "./lead-service";
import * as leadDocumentService from "./lead-document-service";
import { recordAuditEvent } from "./audit-log-service";
import { registerFofoUser } from "./skia-fofo-service";
import { SUBTREE_CTE } from "../utils/subtree";

// Admins open any handoff (the same admin-sees-everything rule as
// listFofoOnboardings below); everyone else only leads they can see.
export async function getHandoff(leadId: string, requestingUserId: string, requestingRole: string) {
  const skipVisibilityCheck = requestingRole === "admin";
  const lead = await leadService.getLeadById(leadId, requestingUserId, { skipVisibilityCheck });
  const documents = await leadDocumentService.listDocuments(leadId);
  // Fetched here (not left to the frontend's own separate /leads/:id/consent
  // call) so it shares the exact same admin bypass as the lead above - an
  // admin viewing a handoff outside their subtree was otherwise getting the
  // lead fine but a 403 on this one.
  const consent = await leadService.getLeadConsent(leadId, requestingUserId, { skipVisibilityCheck });
  return { lead, documents, consent };
}

// Registers the store owner's SKIA FOFO app login via skia-fofo-service, then
// records a real timestamp and a generated reference code so "pushed" is
// genuine, persisted data rather than a UI-only toggle. No approval and no
// handoff step is required (client decision 2026-11-25: an interested client
// is pushed straight away, the field person fills the 5 steps only if they
// want to). The one hard requirement is the lead's mobile number, because
// that number IS the store owner's SKIA FOFO login. If the SKIA FOFO call
// fails, nothing here is marked pushed.
// Leads with a push currently in flight in this process - a double-click
// (or two people pressing it together) must not register the store twice.
const pushesInFlight = new Set<string>();

export async function pushToOnboardingApp(leadId: string, requestingUserId: string, requestingRole: string, ipAddress?: string | null) {
  const inScope = await leadService.isLeadInOwnerScope(leadId, requestingUserId);
  if (!inScope) {
    throw new ApiError(403, "You do not have access to this lead");
  }
  if (pushesInFlight.has(leadId)) {
    throw new ApiError(409, "This lead is already being pushed - please wait a moment");
  }
  pushesInFlight.add(leadId);
  try {
    return await pushToOnboardingAppOnce(leadId, requestingUserId, requestingRole, ipAddress);
  } finally {
    pushesInFlight.delete(leadId);
  }
}

async function pushToOnboardingAppOnce(leadId: string, requestingUserId: string, requestingRole: string, ipAddress?: string | null) {
  const leadResult = await pool.query<{ full_name: string; store_name: string | null; phone: string | null; push_status: string; pushed_at: string | null }>(
    "SELECT full_name, store_name, phone, push_status, pushed_at FROM leads WHERE id = $1 AND is_deleted = false",
    [leadId]
  );
  const lead = leadResult.rows[0];
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }
  // Client-confirmed: the same person legitimately owns many franchises (one
  // lead each, one push each) - that's fine and must stay fine. What's never
  // fine is THIS one lead being pushed a second time.
  if (lead.push_status === "pushed") {
    throw new ApiError(422, `This lead was already pushed to the onboarding app on ${new Date(lead.pushed_at!).toLocaleDateString()}`);
  }
  if (!lead.phone) {
    throw new ApiError(422, "Add the client's mobile number to this lead first - it becomes their SKIA FOFO app login");
  }

  const registration = await registerFofoUser({ userName: lead.full_name, phoneNumber: lead.phone });

  const onboardingAppId = `FOFO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await pool.query(
    "UPDATE leads SET push_status = 'pushed', onboarding_app_id = $1, pushed_at = now(), updated_at = now() WHERE id = $2 AND push_status <> 'pushed'",
    [onboardingAppId, leadId]
  );

  // With no approver any more, this is the record of who pushed and when.
  const leadLabel = lead.store_name ?? lead.full_name;
  await recordAuditEvent({
    entityType: "lead",
    entityId: leadId,
    entityLabel: leadLabel,
    action: "pushed_to_onboarding",
    summary: "pushed this lead to the SKIA FOFO app",
    oldValue: null,
    newValue: `${onboardingAppId} · login ${lead.phone}`,
    actorId: requestingUserId,
    ipAddress,
  });

  const handoff = await getHandoff(leadId, requestingUserId, requestingRole);
  const message = registration.alreadyRegistered
    ? "Pushed to onboarding app - this phone already had a SKIA FOFO account from another franchise, now linked to this store too"
    : "Pushed to onboarding app";
  return { handoff, message };
}

const LIST_COLUMNS = `
  l.id, l.lead_number AS "leadNumber", l.full_name AS "fullName", l.store_name AS "storeName",
  l.store_city AS "storeCity", l.store_state AS "storeState", l.status,
  l.push_status AS "pushStatus", l.expected_value AS "expectedValue", u.name AS "ownerName",
  l.created_at AS "createdAt"
`;

// Same admin-sees-everything rule as getHandoff: an admin who can open any
// handoff sees every FOFO lead listed here too.
export async function listFofoOnboardings(requestingUserId: string, requestingRole: string, page: number, limit: number) {
  const scopeClause = requestingRole === "admin" ? "true" : "l.owner_id IN (SELECT id FROM subtree)";

  const countResult = await pool.query<{ count: string }>(
    `${SUBTREE_CTE}
     SELECT COUNT(*) FROM leads l
     WHERE l.is_deleted = false AND l.category = 'FOFO' AND ${scopeClause}`,
    [requestingUserId]
  );

  const offset = (page - 1) * limit;
  const result = await pool.query<{ expectedValue: string | null } & Record<string, unknown>>(
    `${SUBTREE_CTE}
     SELECT ${LIST_COLUMNS}
     FROM leads l LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.is_deleted = false AND l.category = 'FOFO' AND ${scopeClause}
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
