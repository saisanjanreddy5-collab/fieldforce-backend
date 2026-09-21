import { Router } from "express";
import * as targetController from "../../controllers/target-controller";
import { ADMIN_ONLY, MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createTargetSchema, listTargetsQuerySchema, updateTargetSchema } from "../../validators/target-validator";

const router = Router();

router.use(requireAuth);

// Same gate as GET /users - a Manager only ever sees their own subtree's
// targets (enforced inside the service), an Agent can't reach this at all.
router.get("/", requireRole(...MANAGER_AND_ABOVE), validateQuery(listTargetsQuerySchema), targetController.list);
router.get("/:id", requireRole(...MANAGER_AND_ABOVE), targetController.getById);

// Same gate as register/update-user - targets are set from the same
// Add/Edit User drawer, which is already Admin-only.
router.post("/", requireRole(...ADMIN_ONLY), validateBody(createTargetSchema), targetController.create);
router.patch("/:id", requireRole(...ADMIN_ONLY), validateBody(updateTargetSchema), targetController.update);
router.delete("/:id", requireRole(...ADMIN_ONLY), targetController.remove);

export default router;
