import { Router } from "express";
import * as integrationsController from "../../controllers/integrations-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";

const router = Router();

router.use(requireAuth);

router.get("/status", integrationsController.status);
// Admin-only (users.update): pushes people into Frappe Helpdesk.
router.post("/helpdesk/sync", requirePermission("users.update"), integrationsController.syncHelpdesk);

export default router;
