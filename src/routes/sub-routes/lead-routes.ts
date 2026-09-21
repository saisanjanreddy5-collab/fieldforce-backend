import { Router } from "express";
import * as leadController from "../../controllers/lead-controller";
import * as opportunityController from "../../controllers/opportunity-controller";
import * as activityController from "../../controllers/activity-controller";
import * as microsoftController from "../../controllers/microsoft-controller";
import * as smartfloController from "../../controllers/smartflo-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createLeadSchema, listLeadsQuerySchema, shareLeadSchema, updateLeadSchema } from "../../validators/lead-validator";
import { convertLeadSchema } from "../../validators/opportunity-validator";
import { createActivitySchema } from "../../validators/activity-validator";
import { createTeamsMeetingSchema, sendLeadEmailSchema } from "../../validators/microsoft-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("leads.view"), validateQuery(listLeadsQuerySchema), leadController.list);
router.post("/", requirePermission("leads.create"), validateBody(createLeadSchema), leadController.create);
router.get("/territories", requirePermission("leads.view"), leadController.listTerritories);
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

router.post("/:id/microsoft/email", validateBody(sendLeadEmailSchema), microsoftController.sendEmailForLead);
router.post(
  "/:id/microsoft/teams-meeting",
  validateBody(createTeamsMeetingSchema),
  microsoftController.createMeetingForLead
);

router.post("/:id/call", smartfloController.callLead);

export default router;
