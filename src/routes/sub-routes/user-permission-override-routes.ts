import { Router } from "express";
import * as overrideController from "../../controllers/user-permission-override-controller";
import { ADMIN_ONLY, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createOverrideSchema } from "../../validators/user-permission-override-validator";

const router = Router();

router.use(requireAuth);

// Foundation only (see model.ts). Viewing goes through requirePermission,
// per the post-Phase-3 rule; the writes stay requireRole(ADMIN_ONLY), same
// reasoning as role-permission-routes.ts - this table backs per-employee
// overrides of the very permission system, so its own mutation route can't
// be gated by a permission that lives inside it without risking a lockout.
router.get("/user/:userId", requirePermission("user_permission_overrides.view"), overrideController.listForUser);
router.post("/", requireRole(...ADMIN_ONLY), validateBody(createOverrideSchema), overrideController.create);
router.patch("/:id/clear", requireRole(...ADMIN_ONLY), overrideController.clear);
router.post("/user/:userId/clear-all", requireRole(...ADMIN_ONLY), overrideController.clearAllForUser);

export default router;
