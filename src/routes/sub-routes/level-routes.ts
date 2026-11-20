import { Router } from "express";
import * as levelController from "../../controllers/level-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createLevelSchema, listLevelsQuerySchema, updateLevelSchema } from "../../validators/level-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("levels.view"), validateQuery(listLevelsQuerySchema), levelController.list);
router.post("/", requirePermission("levels.create"), validateBody(createLevelSchema), levelController.create);
router.patch("/:id", requirePermission("levels.update"), validateBody(updateLevelSchema), levelController.update);
// Archive/restore a role - people on it and their data are never touched.
router.patch("/:id/archive", requirePermission("levels.delete"), levelController.archive);
router.patch("/:id/restore", requirePermission("levels.delete"), levelController.restore);

export default router;
