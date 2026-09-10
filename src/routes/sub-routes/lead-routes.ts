import { Router } from "express";
import * as leadController from "../../controllers/lead-controller";
import * as opportunityController from "../../controllers/opportunity-controller";
import * as activityController from "../../controllers/activity-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createLeadSchema, listLeadsQuerySchema, shareLeadSchema, updateLeadSchema } from "../../validators/lead-validator";
import { convertLeadSchema } from "../../validators/opportunity-validator";
import { createActivitySchema } from "../../validators/activity-validator";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listLeadsQuerySchema), leadController.list);
router.post("/", validateBody(createLeadSchema), leadController.create);
router.get("/:id", leadController.getById);
router.patch("/:id", validateBody(updateLeadSchema), leadController.update);
router.delete("/:id", leadController.remove);

router.get("/:id/shares", leadController.listShares);
router.post("/:id/share", validateBody(shareLeadSchema), leadController.share);
router.delete("/:id/share/:userId", leadController.unshare);

router.get("/:id/opportunities", opportunityController.listForLead);
router.post("/:id/convert", validateBody(convertLeadSchema), opportunityController.convert);

router.get("/:id/activities", activityController.listForLead);
router.post("/:id/activities", validateBody(createActivitySchema), activityController.createForLead);

export default router;
