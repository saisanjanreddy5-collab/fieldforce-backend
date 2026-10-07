import { Router } from "express";
import * as auditConsentController from "../../controllers/audit-consent-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import { listAuditLogQuerySchema, listConsentRecordsQuerySchema } from "../../validators/audit-consent-validator";

const router = Router();

router.use(requireAuth);

router.get("/log", requirePermission("audit_log.view"), validateQuery(listAuditLogQuerySchema), auditConsentController.listAuditLog);
router.get("/consent-register", requirePermission("audit_log.view"), auditConsentController.getConsentRegister);
router.get(
  "/consent-records",
  requirePermission("audit_log.view"),
  validateQuery(listConsentRecordsQuerySchema),
  auditConsentController.listConsentRecords
);

export default router;
