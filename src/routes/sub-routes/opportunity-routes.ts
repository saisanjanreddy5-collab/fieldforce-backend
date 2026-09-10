import { Router } from "express";
import * as opportunityController from "../../controllers/opportunity-controller";
import * as activityController from "../../controllers/activity-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { listOpportunitiesQuerySchema, updateOpportunitySchema } from "../../validators/opportunity-validator";
import { createActivitySchema } from "../../validators/activity-validator";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listOpportunitiesQuerySchema), opportunityController.list);
router.get("/:id", opportunityController.getById);
router.patch("/:id", validateBody(updateOpportunitySchema), opportunityController.update);
router.delete("/:id", opportunityController.remove);

router.get("/:id/activities", activityController.listForOpportunity);
router.post("/:id/activities", validateBody(createActivitySchema), activityController.createForOpportunity);

export default router;
