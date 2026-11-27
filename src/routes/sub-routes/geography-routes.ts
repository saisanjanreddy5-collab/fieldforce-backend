import { Router } from "express";
import * as geographyController from "../../controllers/geography-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateQuery } from "../../middleware/validate-middleware";
import {
  listAreasQuerySchema,
  listCitiesQuerySchema,
  listStatesQuerySchema,
  listZonesQuerySchema,
} from "../../validators/geography-validator";

const router = Router();

router.use(requireAuth);

router.get("/zones", validateQuery(listZonesQuerySchema), geographyController.listZones);
router.get("/states", validateQuery(listStatesQuerySchema), geographyController.listStates);
router.get("/cities", validateQuery(listCitiesQuerySchema), geographyController.listCities);
router.get("/areas", validateQuery(listAreasQuerySchema), geographyController.listAreas);

export default router;
