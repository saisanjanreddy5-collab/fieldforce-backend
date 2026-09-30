import { Router } from "express";
import * as websiteLeadSourceController from "../../controllers/website-lead-source-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createWebsiteLeadSourceSchema, updateWebsiteLeadSourceSchema } from "../../validators/website-lead-source-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("website_lead_sources.view"), websiteLeadSourceController.list);
router.post(
  "/",
  requirePermission("website_lead_sources.manage"),
  validateBody(createWebsiteLeadSourceSchema),
  websiteLeadSourceController.create
);
router.patch(
  "/:id",
  requirePermission("website_lead_sources.manage"),
  validateBody(updateWebsiteLeadSourceSchema),
  websiteLeadSourceController.update
);

export default router;
