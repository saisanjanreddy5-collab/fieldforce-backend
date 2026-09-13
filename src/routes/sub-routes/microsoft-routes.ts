import { Router } from "express";
import * as microsoftController from "../../controllers/microsoft-controller";
import { requireAuth } from "../../middleware/auth-middleware";

const router = Router();

// Not behind requireAuth - Microsoft's redirect back to us carries no
// Authorization header; the signed "state" param is what identifies the
// CRM user instead (see microsoft-service.buildAuthUrl / decodeState).
router.get("/callback", microsoftController.callback);

router.get("/connect", requireAuth, microsoftController.connect);
router.get("/status", requireAuth, microsoftController.status);
router.delete("/disconnect", requireAuth, microsoftController.disconnect);

export default router;
