import { Router } from "express";
import * as delegationController from "../../controllers/delegation-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createDelegationSchema } from "../../validators/delegation-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("delegations.view"), delegationController.list);
router.post("/", requirePermission("delegations.create"), validateBody(createDelegationSchema), delegationController.create);
router.delete("/:id", requirePermission("delegations.delete"), delegationController.remove);

export default router;
