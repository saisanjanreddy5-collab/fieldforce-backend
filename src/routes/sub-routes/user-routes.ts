import { Router } from "express";
import * as userController from "../../controllers/user-controller";
import * as testAccessController from "../../controllers/test-access-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { adminResetPasswordSchema, listUsersQuerySchema, updateOwnProfileSchema, updateUserSchema } from "../../validators/user-validator";

const router = Router();

router.get("/", requireAuth, requirePermission("users.view"), validateQuery(listUsersQuerySchema), userController.list);
router.get("/next-employee-code", requireAuth, requirePermission("users.create"), userController.nextEmployeeCode);
router.get("/territories", requireAuth, requirePermission("users.view"), userController.listTerritories);
// Registered before /:id so Express doesn't treat "me" as an id param.
// Self-service, not a tiered authorization action - stays ungated by design.
router.patch("/me", requireAuth, validateBody(updateOwnProfileSchema), userController.updateOwnProfile);
router.patch("/:id", requireAuth, requirePermission("users.update"), validateBody(updateUserSchema), userController.update);
// Deliberately its own permission, not users.update - a different,
// sensitive capability (letting an admin lock someone else out / regain
// access for them) that shouldn't silently come bundled if users.update is
// ever granted more broadly later (e.g. to Manager) for ordinary profile
// editing.
router.post(
  "/:id/reset-password",
  requireAuth,
  requirePermission("users.reset_password"),
  validateBody(adminResetPasswordSchema),
  userController.resetPassword
);
router.get("/:id/test-access", requireAuth, requirePermission("users.view"), testAccessController.getSummary);

export default router;
