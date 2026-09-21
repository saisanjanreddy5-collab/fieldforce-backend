import { Router } from "express";
import * as userIncentivePlanController from "../../controllers/user-incentive-plan-controller";
import { ADMIN_ONLY, MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createUserIncentivePlanSchema,
  listUserIncentivePlansQuerySchema,
} from "../../validators/user-incentive-plan-validator";

const router = Router();

router.use(requireAuth);

// Foundation only - no UI calls this in Phase 1C. Same gates as targets:
// Manager+ can view their own subtree's assignments, only Admin assigns.
router.get("/", requireRole(...MANAGER_AND_ABOVE), validateQuery(listUserIncentivePlansQuerySchema), userIncentivePlanController.list);
router.post("/", requireRole(...ADMIN_ONLY), validateBody(createUserIncentivePlanSchema), userIncentivePlanController.create);
router.delete("/:id", requireRole(...ADMIN_ONLY), userIncentivePlanController.remove);

export default router;
