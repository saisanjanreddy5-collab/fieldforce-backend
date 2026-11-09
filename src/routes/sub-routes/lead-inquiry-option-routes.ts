import { Router } from "express";
import * as leadInquiryOptionController from "../../controllers/lead-inquiry-option-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createLeadInquiryOptionSchema,
  listLeadInquiryOptionsQuerySchema,
  updateLeadInquiryOptionSchema,
} from "../../validators/lead-inquiry-option-validator";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  requirePermission("lead_inquiry_options.view"),
  validateQuery(listLeadInquiryOptionsQuerySchema),
  leadInquiryOptionController.list
);
router.post(
  "/",
  requirePermission("lead_inquiry_options.manage"),
  validateBody(createLeadInquiryOptionSchema),
  leadInquiryOptionController.create
);
router.patch(
  "/:id",
  requirePermission("lead_inquiry_options.manage"),
  validateBody(updateLeadInquiryOptionSchema),
  leadInquiryOptionController.update
);

export default router;
