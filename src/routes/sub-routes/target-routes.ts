import { Router } from "express";
import * as targetController from "../../controllers/target-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createTargetSchema, listTargetsQuerySchema, updateTargetSchema } from "../../validators/target-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("targets.view"), validateQuery(listTargetsQuerySchema), targetController.list);
router.get("/:id", requirePermission("targets.view"), targetController.getById);
router.post("/", requirePermission("targets.create"), validateBody(createTargetSchema), targetController.create);
router.patch("/:id", requirePermission("targets.update"), validateBody(updateTargetSchema), targetController.update);
router.delete("/:id", requirePermission("targets.delete"), targetController.remove);

export default router;
