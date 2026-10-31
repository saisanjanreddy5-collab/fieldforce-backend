import { Router } from "express";
import * as dashboardController from "../../controllers/dashboard-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import { visitHistoryQuerySchema } from "../../validators/dashboard-validator";

const router = Router();

router.use(requireAuth);
// Was missing entirely - every other module (leads, opportunities, etc.)
// gates its routes with requirePermission; this one only checked the caller
// was logged in at all, so revoking dashboard.view from a role had zero
// effect on the actual data endpoints (only hid the sidebar link).
router.use(requirePermission("dashboard.view"));

router.get("/overview", dashboardController.overview);
router.get("/pipeline-by-stage", dashboardController.pipelineByStage);
router.get("/leads-by-status", dashboardController.leadsByStatus);
router.get("/team-performance", dashboardController.teamPerformance);
router.get("/visit-history", validateQuery(visitHistoryQuerySchema), dashboardController.visitHistory);

export default router;
