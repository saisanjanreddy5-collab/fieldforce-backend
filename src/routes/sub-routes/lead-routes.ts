import { Router } from "express";
import * as leadController from "../../controllers/lead-controller";
import * as opportunityController from "../../controllers/opportunity-controller";
import * as activityController from "../../controllers/activity-controller";
import * as microsoftController from "../../controllers/microsoft-controller";
import { emailAttachmentUpload } from "../../services/microsoft-service";
import * as smartfloController from "../../controllers/smartflo-controller";
import * as whatsappController from "../../controllers/whatsapp-controller";
import * as quoteController from "../../controllers/quote-controller";
import * as supportTicketController from "../../controllers/support-ticket-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { bulkImportLeadsSchema, createLeadSchema, listLeadsQuerySchema, shareLeadSchema, updateLeadSchema } from "../../validators/lead-validator";
import { logCallDispositionSchema, reassignLeadSchema, sendToFieldSchema } from "../../validators/call-qualification-validator";
import { convertLeadSchema } from "../../validators/opportunity-validator";
import { createActivitySchema } from "../../validators/activity-validator";
import { createTeamsMeetingSchema, sendLeadEmailSchema } from "../../validators/microsoft-validator";
import { sendWhatsappMessageSchema } from "../../validators/whatsapp-validator";
import { callLeadSchema } from "../../validators/smartflo-validator";

const router = Router();

router.use(requireAuth);

// leads.queue_view is the Call Center "My Queue" tab's own narrow permission
// (its own leads, Call Center/Qualified stage only - see lead-service.ts's
// subtree visibility, unaffected by which permission got them in the door)
// - deliberately independent of leads.view, so hiding the full Leads module
// from a role never breaks their own queue, and vice versa.
router.get("/", requireAnyPermission("leads.view", "leads.queue_view"), validateQuery(listLeadsQuerySchema), leadController.list);
router.post("/", requirePermission("leads.create"), validateBody(createLeadSchema), leadController.create);
// leads.bulk_import is Call Center's own scoped version of this same action
// (executive-matched import into their own queue) - leads.create (Admin/
// Manager) still works unchanged, this just widens who else can reach it
// without touching the full Leads module's other leads.create-gated routes.
router.post(
  "/bulk-import",
  requireAnyPermission("leads.create", "leads.bulk_import"),
  validateBody(bulkImportLeadsSchema),
  leadController.bulkImport
);
// Call Center's own "Add lead" action (a contact who called in directly, not
// from a marketing import) - a separate, narrower permission from the full
// leads.create above, since Call Center never gets that one (see
// role-permission-service.ts). Always lands in the creator's own queue - see
// createOwnQueueLead's own comment for why this isn't just POST / with a flag.
router.post("/queue", requirePermission("leads.queue_create"), validateBody(createLeadSchema), leadController.createOwnQueueLead);
router.get("/territories", requirePermission("leads.view"), leadController.listTerritories);
router.get("/sources", requirePermission("leads.view"), leadController.listSources);
router.get("/quick-filter-counts", requirePermission("leads.view"), leadController.quickFilterCounts);
// "My queue"'s own second section (CallCenterPage.tsx) - leads this person
// used to own and has since handed off via Send to Field. Same widened
// check as the main GET / list route, for the same reason (Call Center
// holds leads.queue_view, not leads.view).
router.get("/handed-off", requireAnyPermission("leads.view", "leads.queue_view"), leadController.listHandedOff);
// Call Center holds leads.queue_view, not leads.view (same reasoning as the
// GET / list route and GET /:id/history above) - EmailComposeDrawer.tsx
// fetches a lead fresh on its own rather than reusing the queue list's
// already-loaded copy, so this single-lead GET needs the same widened
// check. getLeadById still does its own real isLeadVisibleToUser check
// underneath.
router.get("/:id", requireAnyPermission("leads.view", "leads.queue_view"), leadController.getById);
router.patch("/:id", requirePermission("leads.update"), validateBody(updateLeadSchema), leadController.update);
router.delete("/:id", requirePermission("leads.delete"), leadController.remove);

router.get("/:id/shares", requirePermission("leads.view"), leadController.listShares);
router.post("/:id/share", requirePermission("leads.share"), validateBody(shareLeadSchema), leadController.share);
router.delete("/:id/share/:userId", requirePermission("leads.share"), leadController.unshare);

router.get("/:id/opportunities", requirePermission("opportunities.view"), opportunityController.listForLead);
router.post("/:id/convert", requirePermission("opportunities.create"), validateBody(convertLeadSchema), opportunityController.convert);

router.get("/:id/activities", requirePermission("activities.view"), activityController.listForLead);
router.post(
  "/:id/activities",
  requirePermission("activities.create"),
  validateBody(createActivitySchema),
  activityController.createForLead
);

router.get("/:id/consent", requirePermission("leads.view"), leadController.getConsent);
// Call Center holds leads.queue_view, not leads.view (see the GET / route's
// own comment on why those stay separate permissions) - the History button
// is visible to them on their own queue's leads, so the route has to accept
// either. listLeadHistory still does its own real isLeadVisibleToUser check
// underneath, so this only widens who can attempt the call, never who can
// actually see another person's lead.
router.get("/:id/history", requireAnyPermission("leads.view", "leads.queue_view"), leadController.getHistory);

router.post("/:id/call-dispositions", requirePermission("leads.call_log"), validateBody(logCallDispositionSchema), leadController.logCallDisposition);
router.post("/:id/qualify", requirePermission("leads.qualify"), leadController.qualify);
router.post("/:id/escalate-to-slc", requirePermission("leads.escalate"), leadController.escalateToSlc);
router.get("/:id/swap-candidates", requirePermission("leads.reassign"), leadController.getSwapCandidates);
router.post("/:id/send-to-field", requirePermission("leads.send_to_field"), validateBody(sendToFieldSchema), leadController.sendToField);
router.post("/:id/reassign", requirePermission("leads.reassign"), validateBody(reassignLeadSchema), leadController.reassign);

router.get("/:id/quotes", requirePermission("quotes.view"), quoteController.listForLead);

router.get("/:id/support-tickets", requirePermission("support_tickets.view"), supportTicketController.listForLead);

router.post(
  "/:id/microsoft/email",
  requirePermission("activities.create"),
  emailAttachmentUpload.array("attachments", 5),
  validateBody(sendLeadEmailSchema),
  microsoftController.sendEmailForLead
);
router.post(
  "/:id/microsoft/teams-meeting",
  requirePermission("activities.create"),
  validateBody(createTeamsMeetingSchema),
  microsoftController.createMeetingForLead
);

router.post("/:id/call", requirePermission("activities.create"), validateBody(callLeadSchema), smartfloController.callLead);

router.get("/:id/whatsapp-messages", requirePermission("whatsapp.view"), whatsappController.listForLead);
router.post(
  "/:id/whatsapp-messages",
  requirePermission("whatsapp.send"),
  validateBody(sendWhatsappMessageSchema),
  whatsappController.sendForLead
);

export default router;
