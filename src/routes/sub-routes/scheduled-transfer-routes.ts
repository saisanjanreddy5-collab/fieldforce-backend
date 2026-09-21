import { Router } from "express";
import * as scheduledTransferController from "../../controllers/scheduled-transfer-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import {
  createExitSchema,
  createScheduledReassignSchema,
  createTerritoryTransferSchema,
} from "../../validators/scheduled-transfer-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("territory_transfers.view"), scheduledTransferController.list);
router.post(
  "/territory",
  requirePermission("territory_transfers.create"),
  validateBody(createTerritoryTransferSchema),
  scheduledTransferController.createTerritoryTransfer
);
// Scheduled bulk re-assign is still a leads.update action at heart (it
// ends up moving lead ownership, same as the immediate /leads/bulk-reassign
// endpoint) - gated the same way rather than the newer territory_transfers
// permission, so the two stay consistent about who can move records.
router.post(
  "/bulk-reassign",
  requirePermission("leads.update"),
  validateBody(createScheduledReassignSchema),
  scheduledTransferController.createScheduledReassign
);
router.post(
  "/exit",
  requirePermission("territory_transfers.create"),
  validateBody(createExitSchema),
  scheduledTransferController.createExit
);

export default router;
