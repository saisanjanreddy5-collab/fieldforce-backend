import { Router } from "express";
import * as leadCategoryController from "../../controllers/lead-category-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import {
  createLeadCategorySchema,
  reorderLeadCategoriesSchema,
  updateLeadCategorySchema,
} from "../../validators/lead-category-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("lead_categories.view"), leadCategoryController.list);
router.post(
  "/",
  requirePermission("lead_categories.manage"),
  validateBody(createLeadCategorySchema),
  leadCategoryController.create
);
router.patch(
  "/reorder",
  requirePermission("lead_categories.manage"),
  validateBody(reorderLeadCategoriesSchema),
  leadCategoryController.reorder
);
router.patch(
  "/:key",
  requirePermission("lead_categories.manage"),
  validateBody(updateLeadCategorySchema),
  leadCategoryController.update
);

export default router;
