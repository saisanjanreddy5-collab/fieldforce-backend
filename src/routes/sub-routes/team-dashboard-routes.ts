import { Router } from "express";
import * as teamDashboardController from "../../controllers/team-dashboard-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";

const router = Router();

router.use(requireAuth);

router.get("/availability", requirePermission("team_dashboard.view"), teamDashboardController.getAvailability);

export default router;
