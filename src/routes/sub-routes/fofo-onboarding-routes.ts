import { Router } from "express";
import * as fofoOnboardingController from "../../controllers/fofo-onboarding-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { documentUpload } from "../../services/lead-document-service";
import { decideStepSchema, updateDocumentStatusSchema } from "../../validators/fofo-onboarding-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("fofo_onboarding.view"), fofoOnboardingController.list);
router.get("/:leadId", requirePermission("fofo_onboarding.view"), fofoOnboardingController.getHandoff);
router.patch(
  "/steps/:stepId/decide",
  requirePermission("fofo_onboarding.manage"),
  validateBody(decideStepSchema),
  fofoOnboardingController.decideStep
);
router.post("/:leadId/push", requirePermission("fofo_onboarding.manage"), fofoOnboardingController.push);

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

export default router;
