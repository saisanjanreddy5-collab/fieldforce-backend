import { Router } from "express";
import * as rolePermissionController from "../../controllers/role-permission-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { resetRoleToDefaultSchema, setRolePermissionSchema } from "../../validators/role-permission-validator";

const router = Router();

router.use(requireAuth);

// Fully configurable, no hardcoded exception - PATCH/reset gate on the same
// role_permissions.update permission this route mutates. The lockout risk
// that used to justify a hardcoded ADMIN_ONLY here is handled instead at the
// service layer (setRolePermission/resetRoleToDefault refuse any change that
// would leave zero roles holding role_permissions.update), so the guard
// travels with the data rather than living in a route-level exception.
router.get("/", requirePermission("role_permissions.view"), rolePermissionController.list);
router.patch("/", requirePermission("role_permissions.update"), validateBody(setRolePermissionSchema), rolePermissionController.setGrant);
router.post(
  "/reset",
  requirePermission("role_permissions.update"),
  validateBody(resetRoleToDefaultSchema),
  rolePermissionController.resetToDefault
);

export default router;
