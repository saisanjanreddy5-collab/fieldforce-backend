import { Router } from "express";
import * as approvalBandController from "../../controllers/approval-band-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createApprovalBandSchema, updateApprovalBandSchema } from "../../validators/approval-band-validator";

const router = Router();

router.use(requireAuth);

// A new module, so every route wires to requirePermission from day one per
// the post-Phase-3 rule - manager+ can see the configured ladder, only
// admins can change it. Nothing here is consulted by any real
// approval/workflow logic - see the Phase 8 note in models/model.ts and
// approval-band-service.ts.
router.get("/", requirePermission("approval_bands.view"), approvalBandController.list);
router.post("/", requirePermission("approval_bands.create"), validateBody(createApprovalBandSchema), approvalBandController.create);
router.patch("/:id", requirePermission("approval_bands.update"), validateBody(updateApprovalBandSchema), approvalBandController.update);
router.delete("/:id", requirePermission("approval_bands.delete"), approvalBandController.remove);

export default router;
