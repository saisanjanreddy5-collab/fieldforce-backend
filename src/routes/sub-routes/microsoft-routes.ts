import { Router } from "express";
import * as microsoftController from "../../controllers/microsoft-controller";
import { ADMIN_ONLY, requireAuth, requireRole } from "../../middleware/auth-middleware";

const router = Router();

// Not behind requireAuth - Microsoft's redirect back to us carries no
// Authorization header; the signed "state" param is what identifies the
// CRM user instead (see microsoft-service.buildAuthUrl / decodeState).
router.get("/callback", microsoftController.callback);

router.get("/connect", requireAuth, microsoftController.connect);
router.get("/status", requireAuth, microsoftController.status);
router.delete("/disconnect", requireAuth, microsoftController.disconnect);

// Settings > Users & access - admin-only visibility into who on the team
// has linked their own Microsoft 365 account, mirroring user-routes.ts'
// own role-gate (not requirePermission) for this same kind of org-wide
// admin screen.
router.get("/users", requireAuth, requireRole(...ADMIN_ONLY), microsoftController.listUsersStatus);
router.delete("/users/:userId", requireAuth, requireRole(...ADMIN_ONLY), microsoftController.disconnectUser);

export default router;
