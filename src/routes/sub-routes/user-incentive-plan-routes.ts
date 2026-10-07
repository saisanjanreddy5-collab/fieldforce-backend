import { Router } from "express";
import * as userIncentivePlanController from "../../controllers/user-incentive-plan-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createUserIncentivePlanSchema,
  listUserIncentivePlansQuerySchema,
} from "../../validators/user-incentive-plan-validator";

const router = Router();

router.use(requireAuth);

// Foundation only - no UI calls this yet. Reuses the incentive_plans
// permission rather than a separate user_incentive_plans entry: this is
// just "assign a plan to a person" against the same plans, and there's no
// UI section of its own to give a distinct catalog row meaning.
router.get("/", requirePermission("incentive_plans.view"), validateQuery(listUserIncentivePlansQuerySchema), userIncentivePlanController.list);
router.post("/", requirePermission("incentive_plans.create"), validateBody(createUserIncentivePlanSchema), userIncentivePlanController.create);
router.delete("/:id", requirePermission("incentive_plans.delete"), userIncentivePlanController.remove);

export default router;
