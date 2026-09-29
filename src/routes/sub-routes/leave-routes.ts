import { Router } from "express";
import * as leaveController from "../../controllers/leave-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import {
  createLeaveRequestSchema,
  decideLeaveRequestSchema,
  grantCompOffSchema,
  updateLeaveTypeSchema,
} from "../../validators/leave-validator";

const router = Router();

router.use(requireAuth);

// New module, wired to requirePermission from day one per the post-Phase-3
// rule. /team and /comp-off-credits both require leave_requests.approve -
// an agent never holds that permission, which is what actually keeps the
// "who can see/grant for their reports" screens manager+ only, since
// FieldForce has no separate "has direct reports" check of its own.
router.get("/types", requirePermission("leave_types.view"), leaveController.listTypes);
router.patch(
  "/types/:key",
  requirePermission("leave_types.manage"),
  validateBody(updateLeaveTypeSchema),
  leaveController.updateType
);
router.get("/balances", requirePermission("leave_requests.view"), leaveController.getMyBalances);
router.get("/context", requirePermission("leave_requests.view"), leaveController.getContext);
router.get("/mine", requirePermission("leave_requests.view"), leaveController.listMine);
router.get("/team", requirePermission("leave_requests.approve"), leaveController.listTeam);
router.get("/pending-approvals", requirePermission("leave_requests.approve"), leaveController.listPendingApprovals);
router.post("/", requirePermission("leave_requests.create"), validateBody(createLeaveRequestSchema), leaveController.create);
router.patch("/:id/decision", requirePermission("leave_requests.approve"), validateBody(decideLeaveRequestSchema), leaveController.decide);
router.patch("/:id/cancel", requirePermission("leave_requests.update"), leaveController.cancel);
router.post("/comp-off-credits", requirePermission("comp_off_credits.grant"), validateBody(grantCompOffSchema), leaveController.grantCompOff);

export default router;
