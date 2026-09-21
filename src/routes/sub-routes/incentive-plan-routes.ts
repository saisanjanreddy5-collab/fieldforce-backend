import { Router } from "express";
import * as incentivePlanController from "../../controllers/incentive-plan-controller";
import { ADMIN_ONLY, MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createIncentivePlanSchema, updateIncentivePlanSchema } from "../../validators/incentive-plan-validator";

const router = Router();

router.use(requireAuth);

// Configuration data, same visibility shape as sales-teams/levels/offices -
// any Manager+ can view, only Admin can change it.
router.get("/", requireRole(...MANAGER_AND_ABOVE), incentivePlanController.list);
router.get("/:id", requireRole(...MANAGER_AND_ABOVE), incentivePlanController.getById);
router.post("/", requireRole(...ADMIN_ONLY), validateBody(createIncentivePlanSchema), incentivePlanController.create);
router.patch("/:id", requireRole(...ADMIN_ONLY), validateBody(updateIncentivePlanSchema), incentivePlanController.update);
router.delete("/:id", requireRole(...ADMIN_ONLY), incentivePlanController.remove);

export default router;
