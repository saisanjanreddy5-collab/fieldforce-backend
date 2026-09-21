import { Router } from "express";
import * as geographyController from "../../controllers/geography-controller";
import { requireAuth } from "../../middleware/auth-middleware";

const router = Router();

router.use(requireAuth);

router.get("/zones", geographyController.listZones);

export default router;
