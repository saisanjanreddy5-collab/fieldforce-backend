import { Router } from "express";
import * as integrationsController from "../../controllers/integrations-controller";
import { requireAuth } from "../../middleware/auth-middleware";

const router = Router();

router.use(requireAuth);

router.get("/status", integrationsController.status);

export default router;
