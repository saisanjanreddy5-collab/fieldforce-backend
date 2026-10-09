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
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { bulkImportLeadsSchema, createLeadSchema, listLeadsQuerySchema, shareLeadSchema, updateLeadSchema } from "../../validators/lead-validator";
import { convertLeadSchema } from "../../validators/opportunity-validator";
import { createActivitySchema } from "../../validators/activity-validator";
import { createTeamsMeetingSchema, sendLeadEmailSchema } from "../../validators/microsoft-validator";
import { sendWhatsappMessageSchema } from "../../validators/whatsapp-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("leads.view"), validateQuery(listLeadsQuerySchema), leadController.list);
router.post("/", requirePermission("leads.create"), validateBody(createLeadSchema), leadController.create);
router.post("/bulk-import", requirePermission("leads.create"), validateBody(bulkImportLeadsSchema), leadController.bulkImport);
router.get("/territories", requirePermission("leads.view"), leadController.listTerritories);
router.get("/quick-filter-counts", requirePermission("leads.view"), leadController.quickFilterCounts);
router.get("/:id", requirePermission("leads.view"), leadController.getById);
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

router.post("/:id/call", requirePermission("activities.create"), smartfloController.callLead);

router.get("/:id/whatsapp-messages", requirePermission("whatsapp.view"), whatsappController.listForLead);
router.post(
  "/:id/whatsapp-messages",
  requirePermission("whatsapp.send"),
  validateBody(sendWhatsappMessageSchema),
  whatsappController.sendForLead
);

export default router;
