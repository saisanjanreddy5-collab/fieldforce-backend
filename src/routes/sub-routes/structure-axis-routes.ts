import { Router } from "express";
import * as structureAxisController from "../../controllers/structure-axis-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { listStructureAxesQuerySchema, updateStructureAxisSchema } from "../../validators/structure-axis-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("structure_axis.view"), validateQuery(listStructureAxesQuerySchema), structureAxisController.list);
router.patch("/:id", requirePermission("structure_axis.update"), validateBody(updateStructureAxisSchema), structureAxisController.update);

export default router;
