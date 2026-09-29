import { Router } from "express";
import * as assignmentRuleController from "../../controllers/assignment-rule-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createAssignmentRuleSchema, updateAssignmentRuleSchema } from "../../validators/assignment-rule-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("assignment_rules.view"), assignmentRuleController.list);
router.post(
  "/",
  requirePermission("assignment_rules.manage"),
  validateBody(createAssignmentRuleSchema),
  assignmentRuleController.create
);
router.patch(
  "/:id",
  requirePermission("assignment_rules.manage"),
  validateBody(updateAssignmentRuleSchema),
  assignmentRuleController.update
);

export default router;
