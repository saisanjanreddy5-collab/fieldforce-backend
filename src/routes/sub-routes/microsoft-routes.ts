import { Router } from "express";
import * as microsoftController from "../../controllers/microsoft-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";

const router = Router();

// Not behind requireAuth - Microsoft's redirect back to us carries no
// Authorization header; the signed "state" param is what identifies the
// CRM user instead (see microsoft-service.buildAuthUrl / decodeState).
router.get("/callback", microsoftController.callback);

router.get("/connect", requireAuth, microsoftController.connect);
router.get("/status", requireAuth, microsoftController.status);
router.delete("/disconnect", requireAuth, microsoftController.disconnect);

// Settings > Users & access - org-wide visibility into who's linked their
// own Microsoft 365 account, and the ability to disconnect someone else's -
// same users.view/users.update permissions user-routes.ts gates the
// equivalent list/edit actions with.
router.get("/users", requireAuth, requirePermission("users.view"), microsoftController.listUsersStatus);
router.delete("/users/:userId", requireAuth, requirePermission("users.update"), microsoftController.disconnectUser);

export default router;
