import { Router } from "express";
import * as managerChangeLogController from "../../controllers/manager-change-log-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";

const router = Router();

router.use(requireAuth);

// A new module, so it wires to requirePermission from day one per the
// post-Phase-3 rule - nothing here is mutated directly (writes only happen
// via user-service.ts's own manager-change hook), so there's no separate
// write route to gate.
router.get("/", requirePermission("manager_change_log.view"), managerChangeLogController.list);

export default router;
