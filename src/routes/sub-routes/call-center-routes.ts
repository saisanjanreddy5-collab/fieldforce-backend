import { Router } from "express";
import * as callCenterController from "../../controllers/call-center-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import { listCallsQuerySchema, listUpcomingCallsQuerySchema } from "../../validators/call-center-validator";

const router = Router();

router.use(requireAuth);

// Read-only - a call row already exists the moment Smartflo's click-to-call
// webhook lands (see smartflo-service.ts/activity-service.ts), there is
// nothing to create, update, or delete from this module.
router.get("/", requirePermission("call_center.view"), validateQuery(listCallsQuerySchema), callCenterController.list);
router.get(
  "/upcoming",
  requirePermission("call_center.view"),
  validateQuery(listUpcomingCallsQuerySchema),
  callCenterController.upcoming
);

export default router;
