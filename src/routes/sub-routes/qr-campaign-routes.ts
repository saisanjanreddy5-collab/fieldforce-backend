import { Router } from "express";
import * as qrCampaignController from "../../controllers/qr-campaign-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createQrCampaignSchema,
  listQrCampaignsQuerySchema,
  updateQrCampaignSchema,
} from "../../validators/qr-campaign-validator";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  requirePermission("qr_campaigns.view"),
  validateQuery(listQrCampaignsQuerySchema),
  qrCampaignController.list
);
router.get("/summary", requirePermission("qr_campaigns.view"), qrCampaignController.summary);
router.post("/", requirePermission("qr_campaigns.manage"), validateBody(createQrCampaignSchema), qrCampaignController.create);
router.patch("/:id", requirePermission("qr_campaigns.manage"), validateBody(updateQrCampaignSchema), qrCampaignController.update);

export default router;
