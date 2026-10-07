import { Router } from "express";
import * as commissionRuleController from "../../controllers/commission-rule-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import {
  createCommissionRuleSchema,
  listCommissionRulesQuerySchema,
  updateCommissionRuleSchema,
} from "../../validators/commission-rule-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("commission_rules.view"), validateQuery(listCommissionRulesQuerySchema), commissionRuleController.list);
router.get("/:id", requirePermission("commission_rules.view"), commissionRuleController.getById);
router.post("/", requirePermission("commission_rules.create"), validateBody(createCommissionRuleSchema), commissionRuleController.create);
router.patch("/:id", requirePermission("commission_rules.update"), validateBody(updateCommissionRuleSchema), commissionRuleController.update);
router.delete("/:id", requirePermission("commission_rules.delete"), commissionRuleController.remove);

export default router;
