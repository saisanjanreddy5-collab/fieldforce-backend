import { Router } from "express";
import * as structureAxisController from "../../controllers/structure-axis-controller";
import { MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { updateStructureAxisSchema } from "../../validators/structure-axis-validator";

const router = Router();

router.use(requireAuth);

// Same open-read / MANAGER_AND_ABOVE-write shape as offices/levels/sales-teams.
router.get("/", structureAxisController.list);
router.patch("/:id", requireRole(...MANAGER_AND_ABOVE), validateBody(updateStructureAxisSchema), structureAxisController.update);

export default router;
