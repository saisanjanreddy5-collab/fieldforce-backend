import { Router } from "express";
import * as reportController from "../../controllers/report-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { requirePermission } from "../../middleware/permission-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { createSavedViewSchema } from "../../validators/report-validator";

const router = Router();

router.use(requireAuth);
router.use(requirePermission("reports.view"));

router.get("/salesperson", reportController.salespersonPerformance);
router.get("/state-wise", reportController.stateWise);
router.get("/b2b-group", reportController.b2bGroup);
router.get("/lead-source-roi", reportController.leadSourceRoi);
router.get("/fofo-cohort-retention", reportController.fofoCohortRetention);

router.get("/saved-views", reportController.listSavedViews);
router.post("/saved-views", requirePermission("reports.save_view"), validateBody(createSavedViewSchema), reportController.createSavedView);
router.delete("/saved-views/:id", requirePermission("reports.save_view"), reportController.deleteSavedView);

export default router;
