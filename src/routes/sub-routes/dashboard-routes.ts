import { Router } from "express";
import * as dashboardController from "../../controllers/dashboard-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import { visitHistoryQuerySchema } from "../../validators/dashboard-validator";

const router = Router();

router.use(requireAuth);

router.get("/overview", dashboardController.overview);
router.get("/pipeline-by-stage", dashboardController.pipelineByStage);
router.get("/leads-by-status", dashboardController.leadsByStatus);
router.get("/team-performance", dashboardController.teamPerformance);
router.get("/visit-history", validateQuery(visitHistoryQuerySchema), dashboardController.visitHistory);

export default router;
