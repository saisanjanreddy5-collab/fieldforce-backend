import { Router } from "express";
import * as geographyController from "../../controllers/geography-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import { listStatesQuerySchema, listZonesQuerySchema } from "../../validators/geography-validator";

const router = Router();

router.use(requireAuth);

router.get("/zones", validateQuery(listZonesQuerySchema), geographyController.listZones);
router.get("/states", validateQuery(listStatesQuerySchema), geographyController.listStates);

export default router;
