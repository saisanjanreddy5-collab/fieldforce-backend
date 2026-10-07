import { Router } from "express";
import * as overrideController from "../../controllers/user-permission-override-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createOverrideSchema } from "../../validators/user-permission-override-validator";

const router = Router();

router.use(requireAuth);

// Fully configurable, no hardcoded exception. Unlike role_permissions.update,
// this one doesn't need its own lockout guard - losing
// user_permission_overrides.create/.delete everywhere is always recoverable
// by coming back here and re-granting it via role_permissions.update, which
// does have that guard.
router.get("/user/:userId", requirePermission("user_permission_overrides.view"), overrideController.listForUser);
router.post("/", requirePermission("user_permission_overrides.create"), validateBody(createOverrideSchema), overrideController.create);
router.patch("/:id/clear", requirePermission("user_permission_overrides.delete"), overrideController.clear);
router.post("/user/:userId/clear-all", requirePermission("user_permission_overrides.delete"), overrideController.clearAllForUser);

export default router;
