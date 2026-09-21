import { Router } from "express";
import * as officeController from "../../controllers/office-controller";
import { MANAGER_AND_ABOVE, requireAuth, requireRole } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createOfficeSchema, updateOfficeSchema } from "../../validators/office-validator";

const router = Router();

router.use(requireAuth);

// Same shape as Phase 1A: list/get are open to any authenticated user
// (reference data needed by dropdowns everywhere), only create/edit are
// gated - preserved exactly, not tightened or loosened for Phase 2.
router.get("/", officeController.list);
router.get("/:id", officeController.getById);
router.post("/", requireRole(...MANAGER_AND_ABOVE), validateBody(createOfficeSchema), officeController.create);
router.patch("/:id", requireRole(...MANAGER_AND_ABOVE), validateBody(updateOfficeSchema), officeController.update);

export default router;
