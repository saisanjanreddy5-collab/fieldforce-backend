import { Router } from "express";
import * as userController from "../../controllers/user-controller";
import * as testAccessController from "../../controllers/test-access-controller";
import { ADMIN_ONLY, MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { updateUserSchema } from "../../validators/user-validator";

const router = Router();

router.get("/", requireAuth, requireRole(...MANAGER_AND_ABOVE), userController.list);
router.patch("/:id", requireAuth, requireRole(...ADMIN_ONLY), validateBody(updateUserSchema), userController.update);
router.get("/:id/test-access", requireAuth, requireRole(...MANAGER_AND_ABOVE), testAccessController.getSummary);

export default router;
