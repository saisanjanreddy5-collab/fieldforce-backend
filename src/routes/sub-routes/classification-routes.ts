import { Router } from "express";
import * as classificationController from "../../controllers/classification-controller";
import { requireAuth } from "../../middleware/auth-middleware";

const router = Router();

router.use(requireAuth);

// Plain reference-data lookups, same open-read precedent as
// geography's zones/states - no permission gate.
router.get("/division-channels", classificationController.listDivisionChannels);
router.get("/customer-categories", classificationController.listCustomerCategories);

export default router;
