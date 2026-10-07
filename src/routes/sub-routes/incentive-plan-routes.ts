import { Router } from "express";
import * as incentivePlanController from "../../controllers/incentive-plan-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createIncentivePlanSchema,
  listIncentivePlansQuerySchema,
  updateIncentivePlanSchema,
} from "../../validators/incentive-plan-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("incentive_plans.view"), validateQuery(listIncentivePlansQuerySchema), incentivePlanController.list);
router.get("/:id", requirePermission("incentive_plans.view"), incentivePlanController.getById);
router.post("/", requirePermission("incentive_plans.create"), validateBody(createIncentivePlanSchema), incentivePlanController.create);
router.patch("/:id", requirePermission("incentive_plans.update"), validateBody(updateIncentivePlanSchema), incentivePlanController.update);
router.delete("/:id", requirePermission("incentive_plans.delete"), incentivePlanController.remove);

export default router;
