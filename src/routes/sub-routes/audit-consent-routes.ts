import { Router } from "express";
import * as auditConsentController from "../../controllers/audit-consent-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";

const router = Router();

router.use(requireAuth);

router.get("/log", requirePermission("audit_log.view"), auditConsentController.listAuditLog);
router.get("/consent-register", requirePermission("audit_log.view"), auditConsentController.getConsentRegister);
router.get("/consent-records", requirePermission("audit_log.view"), auditConsentController.listConsentRecords);

export default router;
