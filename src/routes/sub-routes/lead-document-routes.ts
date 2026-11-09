import { Router } from "express";
import * as leadDocumentController from "../../controllers/lead-document-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { documentUpload } from "../../services/lead-document-service";

const router = Router();

router.use(requireAuth);

router.get("/:leadId/documents", requirePermission("leads.view"), leadDocumentController.list);
router.post(
  "/:leadId/documents",
  requirePermission("leads.update"),
  documentUpload.single("file"),
  leadDocumentController.upload
);
router.get("/documents/:documentId/file", requirePermission("leads.view"), leadDocumentController.download);
router.delete("/documents/:documentId", requirePermission("leads.update"), leadDocumentController.remove);

export default router;
