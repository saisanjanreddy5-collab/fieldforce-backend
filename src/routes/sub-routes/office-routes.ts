import { Router } from "express";
import * as officeController from "../../controllers/office-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody, validateQuery } from "../../middleware/validate-middleware";
import { createOfficeSchema, listOfficesQuerySchema, updateOfficeSchema } from "../../validators/office-validator";

const router = Router();

router.use(requireAuth);

router.get("/", requirePermission("offices.view"), validateQuery(listOfficesQuerySchema), officeController.list);
router.get("/:id", requirePermission("offices.view"), officeController.getById);
router.post("/", requirePermission("offices.create"), validateBody(createOfficeSchema), officeController.create);
router.patch("/:id", requirePermission("offices.update"), validateBody(updateOfficeSchema), officeController.update);

export default router;
