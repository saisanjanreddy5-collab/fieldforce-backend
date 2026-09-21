import { Router } from "express";
import * as rolePermissionController from "../../controllers/role-permission-controller";
import { ADMIN_ONLY, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { setRolePermissionSchema } from "../../validators/role-permission-validator";

const router = Router();

router.use(requireAuth);

// Viewing the matrix goes through the live permission system, per the
// post-Phase-3 rule that new modules wire to requirePermission from day one.
// Actually changing it stays requireRole(ADMIN_ONLY), deliberately
// independent of role_permissions itself - this route mutates that very
// table, so gating it by a permission stored in that table would let an
// admin lock every admin out with a single bad toggle.
router.get("/", requirePermission("role_permissions.view"), rolePermissionController.list);
router.patch("/", requireRole(...ADMIN_ONLY), validateBody(setRolePermissionSchema), rolePermissionController.setGrant);

export default router;
