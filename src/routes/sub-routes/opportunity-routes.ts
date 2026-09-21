import { Router } from "express";
import * as opportunityController from "../../controllers/opportunity-controller";
import * as activityController from "../../controllers/activity-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { listOpportunitiesQuerySchema, updateOpportunitySchema } from "../../validators/opportunity-validator";
import { createActivitySchema } from "../../validators/activity-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("opportunities.view"), validateQuery(listOpportunitiesQuerySchema), opportunityController.list);
router.get("/:id", requirePermission("opportunities.view"), opportunityController.getById);
router.patch("/:id", requirePermission("opportunities.update"), validateBody(updateOpportunitySchema), opportunityController.update);
router.delete("/:id", requirePermission("opportunities.delete"), opportunityController.remove);

router.get("/:id/activities", requirePermission("activities.view"), activityController.listForOpportunity);
router.post(
  "/:id/activities",
  requirePermission("activities.create"),
  validateBody(createActivitySchema),
  activityController.createForOpportunity
);

export default router;
