import { Router } from "express";
import * as commissionRuleController from "../../controllers/commission-rule-controller";
import { ADMIN_ONLY, MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createCommissionRuleSchema,
  listCommissionRulesQuerySchema,
  updateCommissionRuleSchema,
} from "../../validators/commission-rule-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requireRole(...MANAGER_AND_ABOVE), validateQuery(listCommissionRulesQuerySchema), commissionRuleController.list);
router.get("/:id", requireRole(...MANAGER_AND_ABOVE), commissionRuleController.getById);
router.post("/", requireRole(...ADMIN_ONLY), validateBody(createCommissionRuleSchema), commissionRuleController.create);
router.patch("/:id", requireRole(...ADMIN_ONLY), validateBody(updateCommissionRuleSchema), commissionRuleController.update);
router.delete("/:id", requireRole(...ADMIN_ONLY), commissionRuleController.remove);

export default router;
