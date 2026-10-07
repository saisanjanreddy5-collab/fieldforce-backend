import { Router } from "express";
import * as userController from "../../controllers/user-controller";
import * as testAccessController from "../../controllers/test-access-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { listUsersQuerySchema, updateOwnProfileSchema, updateUserSchema } from "../../validators/user-validator";

const router = Router();

router.get("/", requireAuth, requirePermission("users.view"), validateQuery(listUsersQuerySchema), userController.list);
router.get("/next-employee-code", requireAuth, requirePermission("users.create"), userController.nextEmployeeCode);
router.get("/territories", requireAuth, requirePermission("users.view"), userController.listTerritories);
// Registered before /:id so Express doesn't treat "me" as an id param.
// Self-service, not a tiered authorization action - stays ungated by design.
router.patch("/me", requireAuth, validateBody(updateOwnProfileSchema), userController.updateOwnProfile);
router.patch("/:id", requireAuth, requirePermission("users.update"), validateBody(updateUserSchema), userController.update);
router.get("/:id/test-access", requireAuth, requirePermission("users.view"), testAccessController.getSummary);

export default router;
