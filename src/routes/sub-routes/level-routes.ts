import { Router } from "express";
import * as levelController from "../../controllers/level-controller";
import { MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createLevelSchema, updateLevelSchema } from "../../validators/level-validator";

const router = Router();

router.use(requireAuth);

router.get("/", levelController.list);
router.post("/", requireRole(...MANAGER_AND_ABOVE), validateBody(createLevelSchema), levelController.create);
router.patch("/:id", requireRole(...MANAGER_AND_ABOVE), validateBody(updateLevelSchema), levelController.update);

export default router;
