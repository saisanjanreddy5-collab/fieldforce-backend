import { Router } from "express";
import * as approvalBandController from "../../controllers/approval-band-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createApprovalBandSchema,
  listApprovalBandsQuerySchema,
  updateApprovalBandSchema,
} from "../../validators/approval-band-validator";

const router = Router();

router.use(requireAuth);

// Manager+ can see the configured ladder, only admins can change it. Only
// the 'expense_claim' bands drive a live decision (expense-service.ts's
// resolveSecondApprover); see approval-band-service.ts.
router.get(
  "/",
  requirePermission("approval_bands.view"),
  validateQuery(listApprovalBandsQuerySchema),
  approvalBandController.list
);
router.post("/", requirePermission("approval_bands.create"), validateBody(createApprovalBandSchema), approvalBandController.create);
router.patch("/:id", requirePermission("approval_bands.update"), validateBody(updateApprovalBandSchema), approvalBandController.update);
router.delete("/:id", requirePermission("approval_bands.delete"), approvalBandController.remove);
router.patch("/:id/restore", requirePermission("approval_bands.delete"), approvalBandController.restore);

export default router;
