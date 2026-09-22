import { Router } from "express";
import * as userCommissionController from "../../controllers/user-commission-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createUserCommissionSchema, listUserCommissionsQuerySchema } from "../../validators/user-commission-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("user_commissions.view"), validateQuery(listUserCommissionsQuerySchema), userCommissionController.list);
router.post("/", requirePermission("user_commissions.create"), validateBody(createUserCommissionSchema), userCommissionController.create);
router.delete("/:id", requirePermission("user_commissions.delete"), userCommissionController.remove);

export default router;
