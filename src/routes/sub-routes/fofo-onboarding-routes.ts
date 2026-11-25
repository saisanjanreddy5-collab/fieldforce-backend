import { Router } from "express";
import * as fofoOnboardingController from "../../controllers/fofo-onboarding-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { documentUpload } from "../../services/lead-document-service";
import { listFofoOnboardingsQuerySchema, updateDocumentStatusSchema } from "../../validators/fofo-onboarding-validator";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  requirePermission("fofo_onboarding.view"),
  validateQuery(listFofoOnboardingsQuerySchema),
  fofoOnboardingController.list
);
router.get("/:leadId", requirePermission("fofo_onboarding.view"), fofoOnboardingController.getHandoff);
router.post("/:leadId/push", requirePermission("fofo_onboarding.push"), fofoOnboardingController.push);

router.post(
  "/:leadId/documents",
  requirePermission("fofo_onboarding.upload_document"),
  documentUpload.single("file"),
  fofoOnboardingController.uploadDocument
);
router.get("/documents/:documentId/file", requirePermission("fofo_onboarding.view"), fofoOnboardingController.downloadDocument);
router.patch(
  "/documents/:documentId",
  requirePermission("fofo_onboarding.manage"),
  validateBody(updateDocumentStatusSchema),
  fofoOnboardingController.updateDocumentStatus
);
router.delete("/documents/:documentId", requirePermission("fofo_onboarding.upload_document"), fofoOnboardingController.deleteDocument);

router.get(
  "/:leadId/documents/:docType/history",
  requirePermission("fofo_onboarding.view"),
  fofoOnboardingController.listDocumentHistory
);
router.get(
  "/documents/archive/:archiveId/file",
  requirePermission("fofo_onboarding.view"),
  fofoOnboardingController.downloadArchivedDocument
);
router.patch(
  "/documents/archive/:archiveId/restore",
  requirePermission("fofo_onboarding.upload_document"),
  fofoOnboardingController.restoreArchivedDocument
);

export default router;
